"use strict";

var Transaction = require('dw/system/Transaction');
var Money = require('dw/value/Money');
var BasketMgr = require('dw/order/BasketMgr');
var Resource = require('dw/web/Resource');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var constants = require('*/cartridge/adyen/config/constants');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var {
  AdyenError
} = require('*/cartridge/adyen/logs/adyenError');
function doPartialPaymentsCall(paymentRequest) {
  try {
    return AdyenHelper.executeCall(constants.SERVICE.PAYMENT, paymentRequest);
  } catch (error) {
    AdyenLogs.fatal_log('Partial payments call failed:', error);
    return {
      error: true,
      args: {
        adyenErrorMessage: Resource.msg('confirm.error.declined', 'checkout', null)
      }
    };
  }
}
function responseContainsErrors(response) {
  return (response || {}).error || (response || {}).resultCode !== constants.RESULTCODES.AUTHORISED;
}
function getGiftCardErrorMessage(resultCode) {
  var _messageKeys;
  var messageKeys = (_messageKeys = {}, _messageKeys[constants.RESULTCODES.REFUSED] = 'message.error.giftcard.refused', _messageKeys[constants.RESULTCODES.CANCELLED] = 'message.error.giftcard.cancelled', _messageKeys);
  return Resource.msg(messageKeys[resultCode] || 'message.error.giftcard', 'error', null);
}
function makePartialPayment(req, res, next) {
  try {
    var request = JSON.parse(req.form.data);
    var currentBasket = BasketMgr.getCurrentBasket();
    var {
      encryptedCardNumber,
      encryptedSecurityCode,
      brand,
      giftCardBrand
    } = request;
    var paymentMethod = {
      encryptedCardNumber,
      encryptedSecurityCode,
      brand,
      type: 'giftcard'
    };
    if (!(currentBasket && currentBasket.custom && currentBasket.custom.partialPaymentOrderData)) {
      throw new AdyenError('No partial payment order data found');
    }
    var partialPaymentOrderData = JSON.parse(currentBasket.custom.partialPaymentOrderData);
    var {
      order
    } = partialPaymentOrderData;
    var partialPaymentRequest = {
      merchantAccount: AdyenConfigs.getAdyenMerchantAccount(),
      amount: JSON.parse(currentBasket.custom.adyenGiftCardBalance),
      reference: currentBasket.custom.adyenGiftCardsOrderNo,
      paymentMethod,
      order,
      shopperInteraction: constants.SHOPPER_INTERACTIONS.ECOMMERCE,
      shopperConversionId: session.sessionID.slice(0, 200)
    };
    var response = doPartialPaymentsCall(partialPaymentRequest);
    if (responseContainsErrors(response)) {
      var resultCode = (response || {}).resultCode;
      // Refusal reasons are diagnostic only and must not reach the shopper.
      AdyenLogs.error_log(`Gift card partial payment not authorised. resultCode: ${resultCode}, refusalReason: ${(response || {}).refusalReason}, refusalReasonCode: ${(response || {}).refusalReasonCode}, pspReference: ${(response || {}).pspReference}`);
      res.json({
        error: true,
        resultCode,
        errorMessage: getGiftCardErrorMessage(resultCode)
      });
      return next();
    }
    var discountAmount = new Money(response.amount.value, response.amount.currency);
    var remainingAmount = new Money(response.order.remainingAmount.value, response.order.remainingAmount.currency);
    partialPaymentOrderData.remainingAmount = ((response || {}).order || {}).remainingAmount;
    var divideBy = AdyenHelper.getDivisorForCurrency(remainingAmount);
    var remainingAmountFormatted = remainingAmount.divide(divideBy).toFormattedString();
    response.remainingAmountFormatted = remainingAmountFormatted;
    var discountAmountFormatted = discountAmount.divide(divideBy).toFormattedString();
    response.discountAmountFormatted = discountAmountFormatted;
    var addedGiftCards = currentBasket && currentBasket.custom && currentBasket.custom.adyenGiftCards ? JSON.parse((currentBasket.custom || {}).adyenGiftCards) : [];
    var dataToStore = {
      discountedAmount: discountAmountFormatted,
      expiresAt: response.order.expiresAt,
      giftCard: Object.assign({}, response.paymentMethod, {
        amount: response.amount,
        name: giftCardBrand,
        pspReference: response.pspReference
      }),
      orderAmount: {
        currency: currentBasket.currencyCode,
        value: AdyenHelper.getCurrencyValueForApi(currentBasket.getTotalGrossPrice()).value
      },
      orderCreated: !!(response && response.order && response.order.orderData),
      remainingAmount: response.order.remainingAmount,
      remainingAmountFormatted
    };
    addedGiftCards.push(dataToStore);
    Transaction.wrap(() => {
      currentBasket.custom.adyenGiftCards = JSON.stringify(addedGiftCards);
      currentBasket.custom.partialPaymentOrderData = JSON.stringify(Object.assign({}, partialPaymentOrderData, {
        order: {
          orderData: ((response || {}).order || {}).orderData,
          pspReference: ((response || {}).order || {}).pspReference
        }
      }));
    });
    var totalDiscountedAmount = new Money(addedGiftCards.reduce((accumulator, currentValue) => accumulator + currentValue.giftCard.amount.value, 0), response.order.remainingAmount.currency);
    res.json(Object.assign({}, dataToStore, {
      totalDiscountedAmount: totalDiscountedAmount.divide(divideBy).toFormattedString(),
      giftCards: addedGiftCards,
      message: Resource.msgf('infoMessage.giftCard', 'adyen', null, remainingAmountFormatted)
    }));
  } catch (error) {
    AdyenLogs.error_log('Failed to create partial payment:', error);
    setErrorType(error, res);
  }
  return next();
}
module.exports = makePartialPayment;