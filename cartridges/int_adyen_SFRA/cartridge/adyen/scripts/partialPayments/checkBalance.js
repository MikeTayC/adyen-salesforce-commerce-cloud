'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var Money = require('dw/value/Money');
var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var adyenCheckout = require('*/cartridge/adyen/scripts/payments/adyenCheckout');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var constants = require('*/cartridge/adyen/config/constants');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var failUnsuccessfulKlarnaInlineOrder = require('*/cartridge/adyen/utils/failUnsuccessfulKlarnaInlineOrder');
function getFormattedProperties(checkBalanceResponse, orderAmount) {
    if (checkBalanceResponse.resultCode === 'Success') {
        var remainingAmount = new Money(0, checkBalanceResponse.balance.currency);
        var remainingDivideBy = AdyenHelper.getDivisorForCurrency(remainingAmount);
        var remainingAmountFormatted = remainingAmount.divide(remainingDivideBy).toFormattedString();
        var totalAmount = new Money(orderAmount.value, orderAmount.currency);
        var totalDivideBy = AdyenHelper.getDivisorForCurrency(totalAmount);
        var totalAmountFormatted = totalAmount.divide(totalDivideBy).toFormattedString();
        return {
            remainingAmountFormatted,
            totalAmountFormatted
        };
    }
    return {};
}
function getAddedGiftCards(basket) {
    return basket.custom && basket.custom.adyenGiftCards ? JSON.parse(basket.custom.adyenGiftCards) : null;
}
function callCheckBalance(req, res, next) {
    try {
        failUnsuccessfulKlarnaInlineOrder();
        var currentBasket = BasketMgr.getCurrentBasket();
        var orderNo = (currentBasket.custom || {}).adyenGiftCardsOrderNo || OrderMgr.createOrderNo();
        var giftCardsAdded = getAddedGiftCards(currentBasket);
        var orderAmount = {
            currency: currentBasket.currencyCode,
            value: AdyenHelper.getCurrencyValueForApi(currentBasket.getTotalGrossPrice()).value
        };
        var amount = giftCardsAdded ? giftCardsAdded[giftCardsAdded.length - 1].remainingAmount : orderAmount;
        var request = JSON.parse(req.form.data);
        var paymentMethod = request.paymentMethod ? request.paymentMethod : constants.ACTIONTYPES.GIFTCARD;
        var checkBalanceRequest = {
            merchantAccount: AdyenConfigs.getAdyenMerchantAccount(),
            amount,
            reference: orderNo,
            paymentMethod
        };
        var checkBalanceResponse = adyenCheckout.doCheckBalanceCall(checkBalanceRequest);
        Transaction.wrap(() => {
            currentBasket.custom.adyenGiftCardsOrderNo = orderNo;
            // a balance-less response must not leave a stale balance on the basket
            currentBasket.custom.adyenGiftCardBalance =
                checkBalanceResponse && checkBalanceResponse.balance ? JSON.stringify(checkBalanceResponse.balance) : null;
        });
        res.json(
            Object.assign(
                {
                    resultCode: checkBalanceResponse.resultCode,
                    balance: checkBalanceResponse.balance
                },
                getFormattedProperties(checkBalanceResponse, orderAmount)
            )
        );
    } catch (error) {
        AdyenLogs.error_log('Failed to check gift card balance:', error);
        setErrorType(error, res);
    }
    return next();
}
module.exports = callCheckBalance;
