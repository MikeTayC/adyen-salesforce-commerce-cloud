'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var Transaction = require('dw/system/Transaction');
var URLUtils = require('dw/web/URLUtils');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var { updateSavedCards } = require('*/cartridge/adyen/scripts/payments/updateSavedCards');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
function shouldRestoreBasket(cachedOrderNumber) {
    // restore cart if order number was cached
    if (cachedOrderNumber) {
        var currentBasket = BasketMgr.getCurrentBasket();
        // check if cart is null or empty
        if (!currentBasket || currentBasket.getAllProductLineItems().length === 0) {
            return true;
        }
    }
    return false;
}
function restoreBasket(cachedOrderNumber, cachedOrderToken) {
    var currentOrder = OrderMgr.getOrder(cachedOrderNumber, cachedOrderToken);
    // if order status is CREATED we can fail it and restore basket
    // (getOrder returns null for a stale cache entry or a mismatched token)
    if (((currentOrder || {}).status || {}).value === Order.ORDER_STATUS_CREATED) {
        Transaction.wrap(() => {
            currentOrder.trackOrderChange('Failing order so cart can be restored; Shopper navigated back to checkout.');
            OrderMgr.failOrder(currentOrder, true);
        });
        return true;
    }
    return false;
}
function getAdyenViewData() {
    var clientKey = AdyenConfigs.getAdyenClientKey();
    var environment = AdyenHelper.getCheckoutEnvironment();
    var installments = AdyenConfigs.getAdyenInstallmentsEnabled() ? AdyenConfigs.getCreditCardInstallments() || '[]' : '[]';
    var adyenClientKey = AdyenConfigs.getAdyenClientKey();
    var googleMerchantID = AdyenConfigs.getGoogleMerchantID();
    var merchantAccount = AdyenConfigs.getAdyenMerchantAccount();
    return {
        clientKey,
        environment,
        installments,
        googleMerchantID,
        merchantAccount,
        adyenClientKey
    };
}
function begin(req, res, next) {
    try {
        if (req.currentCustomer.raw.isAuthenticated()) {
            updateSavedCards({
                CurrentCustomer: req.currentCustomer.raw
            });
        }
        var cachedOrderNumber = req.session.privacyCache.get('currentOrderNumber');
        var cachedOrderToken = req.session.privacyCache.get('currentOrderToken');
        if (shouldRestoreBasket(cachedOrderNumber)) {
            if (restoreBasket(cachedOrderNumber, cachedOrderToken)) {
                var emit = (route) => this.emit(route, req, res);
                res.redirect(URLUtils.url('Checkout-Begin', 'stage', 'shipping'));
                emit('route:Complete');
                return true;
            }
        }
        var viewData = res.getViewData();
        viewData.adyen = getAdyenViewData();
        res.setViewData(viewData);
        return next();
    } catch (error) {
        AdyenLogs.error_log('Could not begin checkout:', error);
        setErrorType(error, res, {
            redirectUrl: URLUtils.url('Error-ErrorCode', 'err', 'general').toString()
        });
        return next();
    }
}
module.exports = begin;
