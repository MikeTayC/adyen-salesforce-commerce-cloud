'use strict';

var Transaction = require('dw/system/Transaction');
// script includes
var PaymentMgr = require('dw/order/PaymentMgr');
var Money = require('dw/value/Money');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var constants = require('*/cartridge/adyen/config/constants');
var giftCardsHelper = {
    createGiftCardPaymentInstrument(parsedGiftCardObj, divideBy, order) {
        var paymentInstrument;
        var paidGiftCardAmount = {
            value: parsedGiftCardObj.giftCard.amount.value,
            currency: parsedGiftCardObj.giftCard.amount.currency
        };
        var paidGiftCardAmountFormatted = new Money(paidGiftCardAmount.value, paidGiftCardAmount.currency).divide(divideBy);
        Transaction.wrap(() => {
            paymentInstrument = order.createPaymentInstrument(constants.METHOD_ADYEN_COMPONENT, paidGiftCardAmountFormatted);
            var { paymentProcessor } = PaymentMgr.getPaymentMethod(paymentInstrument.paymentMethod);
            paymentInstrument.paymentTransaction.paymentProcessor = paymentProcessor;
            paymentInstrument.paymentTransaction.transactionID = parsedGiftCardObj.giftCard.pspReference;
            var giftCardPaymentRequest = {
                paymentMethod: {
                    type: parsedGiftCardObj.giftCard.brand
                }
            };
            AdyenHelper.setPaymentInstrumentFields(paymentInstrument, giftCardPaymentRequest, parsedGiftCardObj.giftCard.name);
            paymentInstrument.paymentTransaction.custom.Adyen_log = JSON.stringify(parsedGiftCardObj);
            paymentInstrument.paymentTransaction.custom.Adyen_pspReference = parsedGiftCardObj.giftCard.pspReference;
        });
        AdyenHelper.setPaymentTransactionType(paymentInstrument, parsedGiftCardObj.giftCard);
    }
};
module.exports = giftCardsHelper;
