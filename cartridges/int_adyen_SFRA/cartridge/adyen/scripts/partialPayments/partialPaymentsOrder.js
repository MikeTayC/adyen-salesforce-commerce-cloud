"use strict";

var BasketMgr = require('dw/order/BasketMgr');
var Transaction = require('dw/system/Transaction');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var adyenCheckout = require('*/cartridge/adyen/scripts/payments/adyenCheckout');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var constants = require('*/cartridge/adyen/config/constants');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
function addMinutes(minutes) {
  var date = new Date();
  return new Date(date.getTime() + minutes * 60000);
}
function createPartialPaymentsOrder(req, res, next) {
  try {
    var currentBasket = BasketMgr.getCurrentBasket();
    var giftCardsAdded = currentBasket.custom && currentBasket.custom.adyenGiftCards ? JSON.parse(currentBasket.custom.adyenGiftCards) : null;
    var orderAmount = {
      currency: currentBasket.currencyCode,
      value: AdyenHelper.getCurrencyValueForApi(currentBasket.getTotalGrossPrice()).value
    };
    var amount = giftCardsAdded ? giftCardsAdded[giftCardsAdded.length - 1].remainingAmount : orderAmount;
    var date = addMinutes(constants.GIFTCARD_EXPIRATION_MINUTES);
    var partialPaymentsRequest = {
      amount,
      merchantAccount: AdyenConfigs.getAdyenMerchantAccount(),
      reference: currentBasket.custom.adyenGiftCardsOrderNo,
      expiresAt: date.toISOString()
    };
    var response = adyenCheckout.doCreatePartialPaymentOrderCall(partialPaymentsRequest);
    var partialPaymentAmounts = {
      remainingAmount: (response || {}).remainingAmount,
      amount: orderAmount
    };
    // Cache order data to reuse at payments
    Transaction.wrap(() => {
      currentBasket.custom.partialPaymentOrderData = JSON.stringify(Object.assign({
        order: {
          orderData: (response || {}).orderData,
          pspReference: (response || {}).pspReference
        }
      }, partialPaymentAmounts));
    });
    var responseData = {
      resultCode: (response || {}).resultCode,
      remainingAmount: (response || {}).remainingAmount,
      amount: orderAmount,
      expiresAt: date.toISOString()
    };
    res.json(responseData);
  } catch (error) {
    AdyenLogs.error_log('Failed to create partial payments order:', error);
    setErrorType(error, res);
  }
  return next();
}
module.exports = createPartialPaymentsOrder;