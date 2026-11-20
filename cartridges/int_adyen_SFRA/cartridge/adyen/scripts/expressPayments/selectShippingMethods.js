'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var Resource = require('dw/web/Resource');
var Transaction = require('dw/system/Transaction');
var URLUtils = require('dw/web/URLUtils');
var CartModel = require('*/cartridge/models/cart');
var shippingHelper = require('*/cartridge/scripts/checkout/shippingHelpers');
var basketCalculationHelpers = require('*/cartridge/scripts/helpers/basketCalculationHelpers');
var { PAYMENTMETHODS } = require('*/cartridge/adyen/config/constants');
var adyenCheckout = require('*/cartridge/adyen/scripts/payments/adyenCheckout');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var paypalHelper = require('*/cartridge/adyen/utils/paypalHelper');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var { AdyenError } = require('*/cartridge/adyen/logs/adyenError');

/**
 * Make a request to Adyen to select shipping methods
 */
// eslint-disable-next-line complexity
function callSelectShippingMethod(req, res, next) {
    try {
        var { isExpressPdp, shipmentUUID, methodID, currentPaymentData, paymentMethodType } = JSON.parse(req.form.data);
        var currentBasket = isExpressPdp ? BasketMgr.getTemporaryBasket(session.privacy.temporaryBasketId) : BasketMgr.getCurrentBasket();
        if (!currentBasket) {
            res.json({
                error: true,
                redirectUrl: URLUtils.url('Cart-Show').toString()
            });
            return next();
        }
        var shipment;
        if (shipmentUUID) {
            shipment = shippingHelper.getShipmentByUUID(currentBasket, shipmentUUID);
        } else {
            shipment = currentBasket.defaultShipment;
        }
        Transaction.wrap(() => {
            shippingHelper.selectShippingMethod(shipment, methodID);
            if (currentBasket && !(shipment && shipment.shippingMethod)) {
                throw new AdyenError(`cannot set shippingMethod: ${methodID} for shipment:${(shipment || {}).UUID}`);
            }
            basketCalculationHelpers.calculateTotals(currentBasket);
        });
        var response = {};
        if (paymentMethodType === PAYMENTMETHODS.PAYPAL) {
            var currentShippingMethodsModels = AdyenHelper.getApplicableShippingMethods(shipment);
            if (!(currentShippingMethodsModels && currentShippingMethodsModels.length)) {
                throw new AdyenError('No applicable shipping methods found');
            }
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
        var basketModel = new CartModel(currentBasket);
        var grandTotalAmount = {
            value: currentBasket.getTotalGrossPrice().value,
            currency: currentBasket.getTotalGrossPrice().currencyCode
        };
        response = Object.assign({}, response, basketModel, {
            grandTotalAmount
        });
        res.json(response);
    } catch (error) {
        AdyenLogs.error_log('Failed to set shipping method', error);
        res.setStatusCode(500);
        setErrorType(error, res, {
            errorMessage: Resource.msg('error.cannot.select.shipping.method', 'cart', null)
        });
    }
    return next();
}
module.exports = callSelectShippingMethod;
