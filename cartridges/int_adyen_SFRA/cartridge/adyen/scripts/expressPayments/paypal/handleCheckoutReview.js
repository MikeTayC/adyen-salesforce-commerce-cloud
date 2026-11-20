'use strict';

var URLUtils = require('dw/web/URLUtils');
var BasketMgr = require('dw/order/BasketMgr');
var Locale = require('dw/util/Locale');
var AccountModel = require('*/cartridge/models/account');
var OrderModel = require('*/cartridge/models/order');
var validationHelpers = require('*/cartridge/scripts/helpers/basketValidationHelpers');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');

/**
 * Controller for the checkout review page for express payment methods
 * @param {sfra.Request} req - request
 * @param {sfra.Response} res - response
 * @param {sfra.Next} next - next
 * @returns {sfra.Next} next - next
 */
// eslint-disable-next-line
function handleCheckoutReview(req, res, next) {
    try {
        var tempBasketId = session.privacy.temporaryBasketId;
        var currentBasket = tempBasketId ? BasketMgr.getTemporaryBasket(tempBasketId) : BasketMgr.getCurrentBasket();
        if (!currentBasket) {
            res.redirect(URLUtils.url('Cart-Show'));
            return next();
        }
        var validatedProducts = validationHelpers.validateProducts(currentBasket);
        if (validatedProducts.error) {
            res.redirect(URLUtils.url('Cart-Show'));
            return next();
        }
        var currentCustomer = req.currentCustomer.raw;
        var currentLocale = Locale.getLocale(req.locale.id);
        var usingMultiShipping = req.session.privacyCache.get('usingMultiShipping');
        var orderModel = new OrderModel(currentBasket, {
            customer: currentCustomer,
            usingMultiShipping,
            shippable: true,
            countryCode: currentLocale.country,
            containerView: 'basket'
        });
        var accountModel = new AccountModel(req.currentCustomer);
        var { paypalExpressPaymentData } = currentBasket.custom;
        if (!paypalExpressPaymentData) {
            res.redirect(URLUtils.url('Cart-Show'));
            return next();
        }
        res.render('cart/checkoutReview', {
            data: paypalExpressPaymentData,
            showConfirmationUrl: URLUtils.https('Adyen-ShowConfirmationPaymentFromComponent'),
            order: orderModel,
            customer: accountModel
        });
    } catch (error) {
        AdyenLogs.error_log('Could not render checkout review page', error);
        setErrorType(error, res, {
            redirectUrl: URLUtils.url('Error-ErrorCode', 'err', 'general').toString()
        });
    }
    return next();
}
module.exports = handleCheckoutReview;
