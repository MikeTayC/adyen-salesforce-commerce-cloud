'use strict';

var URLUtils = require('dw/web/URLUtils');
var BasketMgr = require('dw/order/BasketMgr');
var paypalHelper = require('*/cartridge/adyen/utils/paypalHelper');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
function saveShopperData(req, res, next) {
    try {
        var shopperDetails = JSON.parse(req.form.data);
        var { isExpressPdp } = shopperDetails;
        var currentBasket = isExpressPdp ? BasketMgr.getTemporaryBasket(session.privacy.temporaryBasketId) : BasketMgr.getCurrentBasket();
        paypalHelper.setBillingAndShippingAddress(currentBasket, shopperDetails);
        res.json({
            success: true
        });
        return next();
    } catch (error) {
        AdyenLogs.error_log('Failed to save the shopper details:', error);
        setErrorType(error, res, {
            redirectUrl: URLUtils.url('Error-ErrorCode', 'err', 'general').toString()
        });
        return next();
    }
}
module.exports = saveShopperData;
