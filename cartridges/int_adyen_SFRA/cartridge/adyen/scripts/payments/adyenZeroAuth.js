"use strict";

/* API Includes */
var URLUtils = require('dw/web/URLUtils');

/* Script Modules */
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var constants = require('*/cartridge/adyen/config/constants');
function zeroAuthPayment(customer, paymentInstrument) {
  var zeroAuthRequest = AdyenHelper.createAdyenRequestObject('recurringPayment-account', 'recurringPayment-token', paymentInstrument, customer.getProfile().email);
  zeroAuthRequest = AdyenHelper.add3DS2Data(zeroAuthRequest);
  zeroAuthRequest.amount = {
    currency: session.currency.currencyCode,
    value: 0
  };
  zeroAuthRequest.returnUrl = URLUtils.https('Adyen-Redirect3DS1Response').toString();
  zeroAuthRequest.storePaymentMethod = true;
  zeroAuthRequest.recurringProcessingModel = constants.RECURRING_PROCESSING_MODEL.CARD_ON_FILE;
  zeroAuthRequest.shopperReference = customer.getProfile().getCustomerNo();
  zeroAuthRequest.shopperEmail = customer.getProfile().getEmail();
  zeroAuthRequest.shopperIP = request.getHttpRemoteAddress();
  return AdyenHelper.executeCall(constants.SERVICE.PAYMENT, zeroAuthRequest);
}
module.exports = {
  zeroAuthPayment
};