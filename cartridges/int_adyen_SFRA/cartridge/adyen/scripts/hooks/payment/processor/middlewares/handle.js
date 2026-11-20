'use strict';

var Transaction = require('dw/system/Transaction');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var collections = require('*/cartridge/scripts/util/collections');
var constants = require('*/cartridge/adyen/config/constants');
function removeAllPaymentInstruments(currentBasket) {
    collections.forEach(currentBasket.getPaymentInstruments(), (item) => {
        currentBasket.removePaymentInstrument(item);
    });
}
function resolveCardBrand(paymentInformation, stateData) {
    return (
        paymentInformation.cardType || // co-branded cards carry the shopper's brand selection in the state data
        ((stateData || {}).paymentMethod || {}).brand ||
        ((stateData || {}).paymentMethod || {}).srcScheme
    );
}
function resolveSfccCardType(paymentInformation, cardBrand) {
    if (paymentInformation.creditCardToken) {
        return paymentInformation.cardType;
    }
    return cardBrand ? AdyenHelper.getSfccCardType(cardBrand) : '';
}
function setCardPaymentMethod(paymentInstrument, paymentMethodNames) {
    var { sfccCardType, cardBrand, adyenPaymentMethod } = paymentMethodNames;
    // brands missing from card-type-mapping.json must not blank the attributes
    var paymentMethodName = sfccCardType || cardBrand || adyenPaymentMethod;
    if (!paymentMethodName) {
        return;
    }
    paymentInstrument.custom.adyenPaymentMethod = paymentMethodName;
    paymentInstrument.custom[`${constants.OMS_NAMESPACE}__Adyen_Payment_Method`] = paymentMethodName;
}
function setStoredCardFields(paymentInformation, paymentInstrument) {
    var firstTwoDigitsFromCurrentYear = AdyenHelper.getFirstTwoNumbersFromYear();
    var expirationYear = firstTwoDigitsFromCurrentYear * 100 + paymentInformation.expirationYear;
    paymentInstrument.setCreditCardExpirationMonth(paymentInformation.expirationMonth);
    paymentInstrument.setCreditCardExpirationYear(expirationYear);
    paymentInstrument.setCreditCardToken(paymentInformation.creditCardToken);
}
function convertToSfccCardType(paymentInformation, paymentInstrument) {
    var stateData = JSON.parse(paymentInformation.stateData);
    var cardBrand = resolveCardBrand(paymentInformation, stateData);
    var sfccCardType = resolveSfccCardType(paymentInformation, cardBrand);
    paymentInstrument.setCreditCardNumber(paymentInformation.cardNumber);
    if (sfccCardType) {
        paymentInstrument.setCreditCardType(sfccCardType);
    }
    if (paymentInformation.cardHolder) {
        paymentInstrument.setCreditCardHolder(paymentInformation.cardHolder);
    }
    setCardPaymentMethod(paymentInstrument, {
        sfccCardType,
        cardBrand,
        adyenPaymentMethod: paymentInformation.adyenPaymentMethod
    });
    if (paymentInformation.creditCardToken) {
        setStoredCardFields(paymentInformation, paymentInstrument);
    }
}
function handle(basket, paymentInformation) {
    var currentBasket = basket;
    var cardErrors = {};
    var serverErrors = [];
    Transaction.wrap(() => {
        removeAllPaymentInstruments(currentBasket);
        var paymentInstrumentType = AdyenHelper.getPaymentInstrumentType(paymentInformation.isCreditCard);
        var paymentInstrument = currentBasket.createPaymentInstrument(paymentInstrumentType, currentBasket.totalGrossPrice);
        paymentInstrument.custom.adyenPaymentData = paymentInformation.stateData;
        paymentInstrument.custom.adyenMainPaymentInstrument = paymentInstrumentType;
        paymentInstrument.custom.adyenPaymentMethod = paymentInformation.adyenPaymentMethod;
        if (paymentInformation.partialPaymentsOrder) {
            paymentInstrument.custom.adyenPartialPaymentsOrder = currentBasket.custom.partialPaymentOrderData;
        }
        if (paymentInformation.stateData) {
            var paymentRequest = JSON.parse(paymentInformation.stateData);
            AdyenHelper.setPaymentInstrumentFields(paymentInstrument, paymentRequest, paymentInformation.adyenPaymentMethod);
        }
        if (paymentInformation.isCreditCard) {
            convertToSfccCardType(paymentInformation, paymentInstrument);
        }
    });
    return {
        fieldErrors: cardErrors,
        serverErrors,
        error: false
    };
}
module.exports = handle;
