"use strict";

var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
var array = require('*/cartridge/scripts/util/array');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
function getCreditCardErrors(req, isCreditCard, paymentForm) {
  if (!req.form.storedPaymentUUID && isCreditCard) {
    // verify credit card form data
    return COHelpers.validateCreditCard(paymentForm);
  }
  return {};
}
function setSessionPrivacy({
  adyenPaymentFields
}) {
  session.privacy.adyenFingerprint = adyenPaymentFields.adyenFingerprint.value;
}
function getPaymentInstrument(req, storedPaymentMethodId) {
  var {
    currentCustomer
  } = req;
  var findById = item => storedPaymentMethodId === item.getCreditCardToken();
  var paymentInstruments = AdyenHelper.getCustomer(currentCustomer).getProfile().getWallet().getPaymentInstruments();
  return array.find(paymentInstruments, findById);
}

// process payment information
function getProcessFormResult(paymentMethod, req, viewData) {
  var {
    authenticated,
    registered
  } = req.currentCustomer.raw;
  if (paymentMethod.storedPaymentMethodId && authenticated && registered) {
    var paymentInstrument = getPaymentInstrument(req, paymentMethod.storedPaymentMethodId);
    return {
      error: false,
      viewData: Object.assign({}, viewData, {
        paymentInformation: Object.assign({}, viewData.paymentInformation, {
          cardNumber: paymentInstrument.creditCardNumber,
          cardType: paymentInstrument.creditCardType,
          securityCode: req.form.securityCode,
          expirationMonth: paymentInstrument.creditCardExpirationMonth,
          expirationYear: paymentInstrument.creditCardExpirationYear,
          creditCardToken: paymentInstrument.creditCardToken,
          cardHolder: paymentInstrument.creditCardHolder
        })
      })
    };
  }
  return {
    error: false,
    viewData
  };
}
function getViewData(viewFormData, paymentForm, isCreditCard, adyenPaymentMethod, adyenIssuerName) {
  return Object.assign({}, viewFormData, {
    paymentMethod: {
      value: paymentForm.paymentMethod.value,
      htmlName: paymentForm.paymentMethod.value
    },
    paymentInformation: {
      isCreditCard,
      cardType: paymentForm.creditCardFields.cardType.value,
      cardNumber: paymentForm.creditCardFields.cardNumber.value,
      adyenPaymentMethod,
      adyenIssuerName,
      stateData: paymentForm.adyenPaymentFields.adyenStateData.value,
      partialPaymentsOrder: paymentForm.adyenPaymentFields.adyenPartialPaymentsOrder.value
    },
    saveCard: paymentForm.creditCardFields.saveCard.checked
  });
}
function getPaymentMethodFromForm(paymentForm) {
  try {
    return JSON.parse(((paymentForm.adyenPaymentFields || {}).adyenStateData || {}).value).paymentMethod;
  } catch (error) {
    AdyenLogs.error_log('Failed to parse payment form stateData:', error);
    return {};
  }
}

/**
 * Verifies the required information for billing form is provided.
 * @param {Object} req - The request object
 * @param {Object} paymentForm - the payment form
 * @param {Object} viewFormData - object contains billing form data
 * @returns {Object} an object that has error information or payment information
 */
function processForm(req, paymentForm, viewFormData) {
  var brand = JSON.stringify(req.form.brandCode);
  var indexOfResult = brand && brand.indexOf('storedCard');
  var isCreditCard = req.form.brandCode === 'scheme' || indexOfResult > -1;
  var creditCardErrors = getCreditCardErrors(req, isCreditCard, paymentForm);
  if (Object.keys(creditCardErrors).length) {
    return {
      fieldErrors: creditCardErrors,
      error: true
    };
  }
  setSessionPrivacy(paymentForm);
  var {
    adyenPaymentMethod,
    adyenIssuerName
  } = req.form;
  if (adyenPaymentMethod === undefined) {
    adyenPaymentMethod = null;
  }
  if (adyenIssuerName === undefined) {
    adyenIssuerName = null;
  }
  var paymentMethod = getPaymentMethodFromForm(paymentForm);
  var viewData = getViewData(viewFormData, paymentForm, isCreditCard, adyenPaymentMethod, adyenIssuerName);
  return getProcessFormResult(paymentMethod, req, viewData);
}
module.exports = processForm;