"use strict";

// script include
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var constants = require('*/cartridge/adyen/config/constants');
var blockedPayments = require('*/cartridge/adyen/config/blockedPaymentMethods.json');

// eslint-disable-next-line complexity
function getMethods(paymentAmount, customer, countryCode, shopperEmail, allowedPaymentMethods) {
  var paymentMethodsRequest = {
    merchantAccount: AdyenConfigs.getAdyenMerchantAccount(),
    amount: {
      currency: paymentAmount.currencyCode,
      value: paymentAmount.value
    }
  };
  if (countryCode) {
    paymentMethodsRequest.countryCode = countryCode;
  }
  if (request.getLocale()) {
    paymentMethodsRequest.shopperLocale = request.getLocale();
  }
  if (shopperEmail) {
    paymentMethodsRequest.shopperEmail = shopperEmail;
  }
  if (allowedPaymentMethods) {
    paymentMethodsRequest.allowedPaymentMethods = allowedPaymentMethods;
  }

  // check logged in shopper for oneClick
  var profile = customer && customer.registered && customer.getProfile() ? customer.getProfile() : null;
  var customerID = null;
  if (profile && profile.getCustomerNo()) {
    customerID = profile.getCustomerNo();
  }
  if (customerID) {
    paymentMethodsRequest.shopperReference = customerID;
  }
  paymentMethodsRequest.blockedPaymentMethods = blockedPayments.blockedPaymentMethods;
  paymentMethodsRequest.shopperConversionId = session.sessionID.slice(0, 200);
  return AdyenHelper.executeCall(constants.SERVICE.CHECKOUTPAYMENTMETHODS, paymentMethodsRequest);
}
module.exports = {
  getMethods
};