'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var Transaction = require('dw/system/Transaction');
var Resource = require('dw/web/Resource');
var URLUtils = require('dw/web/URLUtils');
var basketCalculationHelpers = require('*/cartridge/scripts/helpers/basketCalculationHelpers');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var { PAYMENTMETHODS } = require('*/cartridge/adyen/config/constants');
var adyenCheckout = require('*/cartridge/adyen/scripts/payments/adyenCheckout');
var paypalHelper = require('*/cartridge/adyen/utils/paypalHelper');
var Collections = require('*/cartridge/scripts/util/collections');
var shippingHelper = require('*/cartridge/scripts/checkout/shippingHelpers');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var { AdyenError } = require('*/cartridge/adyen/logs/adyenError');
function updateShippingAddress(currentBasket, address) {
    if (address) {
        var { shippingAddress } = currentBasket.getDefaultShipment();
        Transaction.wrap(() => {
            if (!shippingAddress) {
                shippingAddress = currentBasket.getDefaultShipment().createShippingAddress();
            }
            shippingAddress.setCity((address || {}).city);
            shippingAddress.setPostalCode((address || {}).postalCode);
            shippingAddress.setStateCode((address || {}).stateCode);
            shippingAddress.setCountryCode((address || {}).countryCode);
        });
    }
}
function getBasket(isExpressPdp) {
    return isExpressPdp ? BasketMgr.getTemporaryBasket(session.privacy.temporaryBasketId) : BasketMgr.getCurrentBasket();
}
/**
 * Make a request to Adyen to get shipping methods
 */
function callGetShippingMethods(req, res, next) {
    try {
        var { address, currentPaymentData, paymentMethodType, isExpressPdp } = JSON.parse(req.form.data);
        var currentBasket = getBasket(isExpressPdp);
        if (!currentBasket) {
            res.json({
                error: true,
                redirectUrl: URLUtils.url('Cart-Show').toString()
            });
            return next();
        }
        updateShippingAddress(currentBasket, address);
        var currentShippingMethodsModels = [];
        var shipments = currentBasket.getShipments();
        Collections.forEach(shipments, (shipment) => {
            if (currentShippingMethodsModels.length > 0) return;
            var methods = AdyenHelper.getApplicableShippingMethods(shipment, address);
            var findResult = methods && methods.find((method) => method.selected);
            var selectedMethod = findResult;
            Transaction.wrap(() => {
                shippingHelper.selectShippingMethod(shipment, (selectedMethod || {}).ID || null);
                basketCalculationHelpers.calculateTotals(currentBasket);
            });
            if (methods && methods.length > 0) {
                currentShippingMethodsModels = methods;
            }
        });
        if (!(currentShippingMethodsModels && currentShippingMethodsModels.length)) {
            throw new AdyenError('No applicable shipping methods found');
        }
        var response = {};
        if (paymentMethodType === PAYMENTMETHODS.PAYPAL) {
            var paypalUpdateOrderResponse = adyenCheckout.doPaypalUpdateOrderCall(
                paypalHelper.createPaypalUpdateOrderRequest(
                    session.privacy.pspReference,
                    currentBasket,
                    currentShippingMethodsModels,
                    currentPaymentData
                )
            );
            AdyenLogs.info_log(`Paypal Order Update Call: ${paypalUpdateOrderResponse.status}`);
            response = Object.assign({}, response, paypalUpdateOrderResponse);
        }
        response.shippingMethods = currentShippingMethodsModels;
        res.json(response);
        return next();
    } catch (error) {
        AdyenLogs.error_log('Failed to fetch shipping methods', error);
        res.setStatusCode(500);
        setErrorType(error, res, {
            errorMessage: Resource.msg('error.cannot.find.shipping.methods', 'cart', null)
        });
        return next();
    }
}
module.exports = callGetShippingMethods;
