'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var Money = require('dw/value/Money');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var clearForms = require('*/cartridge/adyen/utils/clearForms');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
function fetchGiftCards(req, res, next) {
    try {
        var currentBasket = BasketMgr.getCurrentBasket();
        var addedGiftCards =
            currentBasket && currentBasket.custom && currentBasket.custom.adyenGiftCards ? JSON.parse(currentBasket.custom.adyenGiftCards) : [];
        var totalDiscountedAmount = null;
        if (addedGiftCards && addedGiftCards.length) {
            var divideBy = AdyenHelper.getDivisorForCurrency({
                currencyCode: currentBasket.currencyCode
            });
            totalDiscountedAmount = new Money(
                addedGiftCards.reduce((accumulator, currentValue) => accumulator + currentValue.giftCard.amount.value, 0),
                addedGiftCards[addedGiftCards.length - 1].giftCard.amount.currency
            )
                .divide(divideBy)
                .toFormattedString();
        }
        res.json({
            giftCards: addedGiftCards,
            totalDiscountedAmount
        });
    } catch (error) {
        AdyenLogs.error_log('Failed to fetch gift cards:', error);
        var _currentBasket = BasketMgr.getCurrentBasket();
        clearForms.clearAdyenBasketData(_currentBasket);
        setErrorType(error, res);
    }
    return next();
}
module.exports = fetchGiftCards;
