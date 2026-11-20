'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
function getBasketAmount(req, res, next) {
    try {
        var currentBasket = BasketMgr.getCurrentBasket();
        if (!currentBasket) {
            res.json({
                error: true,
                message: 'No basket found'
            });
            return next();
        }
        var totalGrossPrice = currentBasket.getTotalGrossPrice();
        var divideBy = AdyenHelper.getDivisorForCurrency({
            currencyCode: totalGrossPrice.currencyCode
        });
        res.json({
            basketAmount: {
                currency: totalGrossPrice.currencyCode,
                value: totalGrossPrice.multiply(divideBy).value
            }
        });
    } catch (error) {
        AdyenLogs.error_log('Failed to get basket amount:', error);
        setErrorType(error, res);
    }
    return next();
}
module.exports = getBasketAmount;
