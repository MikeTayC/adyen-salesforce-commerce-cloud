'use strict';

function getField(name, obj) {
    var _ref;
    return obj && ((_ref = {}), (_ref[name] = obj), _ref);
}
function getParsedField(name, str) {
    var _ref2;
    return str && ((_ref2 = {}), (_ref2[name] = JSON.parse(str)), _ref2);
}
function getOrNull(name, obj) {
    var _ref3, _ref4;
    return obj ? ((_ref3 = {}), (_ref3[name] = obj), _ref3) : ((_ref4 = {}), (_ref4[name] = null), _ref4);
}
module.exports.createSelectedPaymentInstruments = function createSelectedPaymentInstruments({
    paymentMethod,
    paymentTransaction,
    custom,
    creditCardNumberLastDigits,
    creditCardExpirationMonth,
    creditCardExpirationYear,
    creditCardHolder,
    creditCardType,
    giftCertificateCode,
    maskedGiftCertificateCode,
    maskedCreditCardNumber
}) {
    var results = Object.assign(
        {
            paymentMethod,
            amount: paymentTransaction.amount.value
        },
        getField('selectedAdyenPM', custom.adyenPaymentMethod),
        getField('selectedIssuerName', custom.adyenIssuerName),
        getParsedField('adyenAdditionalPaymentData', custom.adyenAdditionalPaymentData),
        getField('adyenAction', custom.adyenAction),
        getOrNull('lastFour', creditCardNumberLastDigits),
        getOrNull('owner', creditCardHolder),
        getOrNull('expirationYear', creditCardExpirationYear),
        getOrNull('type', creditCardType),
        getOrNull('maskedCreditCardNumber', maskedCreditCardNumber),
        getOrNull('expirationMonth', creditCardExpirationMonth)
    );
    if (paymentMethod === 'GIFT_CERTIFICATE') {
        results.giftCertificateCode = giftCertificateCode;
        results.maskedGiftCertificateCode = maskedGiftCertificateCode;
    }
    return results;
};
