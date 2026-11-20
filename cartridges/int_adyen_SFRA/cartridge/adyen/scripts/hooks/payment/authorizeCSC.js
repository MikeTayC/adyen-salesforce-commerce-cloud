"use strict";

var Status = require('dw/system/Status');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var localeHelper = require('*/cartridge/adyen/utils/localeHelper');
var constants = require('*/cartridge/adyen/config/constants');
var ADYEN_PBL_NOTE_KEY = 'Adyen Payment Link';
function getBillingAddressDetails(billingAddress) {
  var billingStreet = '';
  var billingHouseNumberOrName = '';
  var billingCountry = billingAddress.countryCode ? billingAddress.countryCode.value.toUpperCase() : 'ZZ';
  if (billingAddress.address1) {
    billingStreet = billingAddress.address1;
    if (billingAddress.address2) {
      billingHouseNumberOrName = billingAddress.address2;
    }
  } else {
    billingStreet = 'N/A';
  }
  return {
    billingStreet,
    billingHouseNumberOrName,
    billingCountry
  };
}
function buildPaymentLinkRequest(order, pt, billingAddress, billingCountry, billingStreet, billingHouseNumberOrName) {
  var paymentLinkRequest = {
    reference: order.orderNo,
    amount: {
      value: AdyenHelper.getCurrencyValueForApi((pt || {}).amount).getValueOrNull(),
      currency: pt.amount.currencyCode
    },
    countryCode: billingCountry,
    merchantAccount: AdyenConfigs.getAdyenMerchantAccount(),
    shopperInteraction: 'Ecommerce',
    shopperReference: order.getCustomerNo(),
    shopperEmail: order.getCustomerEmail(),
    shopperLocale: localeHelper.getShopperLocale(order.customerLocaleID)
  };
  paymentLinkRequest.billingAddress = {
    city: billingAddress.city ? billingAddress.city : 'N/A',
    country: billingCountry,
    houseNumberOrName: billingHouseNumberOrName,
    postalCode: billingAddress.postalCode ? billingAddress.postalCode : 'N/A',
    stateOrProvince: billingAddress.stateCode ? billingAddress.stateCode : 'N/A',
    street: billingStreet
  };
  return paymentLinkRequest;
}
function createAdyenPaymentLink(paymentLinkRequest) {
  try {
    return AdyenHelper.executeCall(constants.SERVICE.PAYMENT_LINKS, paymentLinkRequest);
  } catch (e) {
    AdyenLogs.error_log(`Failed to create Adyen payment link for order ${paymentLinkRequest.reference}`, e);
    return null;
  }
}
function addPaymentLinkNote(order, paymentLinkUrl) {
  order.addNote(ADYEN_PBL_NOTE_KEY, paymentLinkUrl);
}
function authorizeAdyenPayment(order, pt) {
  try {
    var billingAddress = order.getBillingAddress();
    var {
      billingStreet,
      billingHouseNumberOrName,
      billingCountry
    } = getBillingAddressDetails(billingAddress);
    var paymentLinkRequest = buildPaymentLinkRequest(order, pt, billingAddress, billingCountry, billingStreet, billingHouseNumberOrName);
    var response = createAdyenPaymentLink(paymentLinkRequest);
    if (response && response.url) {
      addPaymentLinkNote(order, response.url);
    }
    return response.url;
  } catch (e) {
    AdyenLogs.error_log(`Error during Adyen Payment Link authorization for order ${order.orderNo}`, e);
    return null;
  }
}
function authorizeCSC(order, opi) {
  try {
    if (request.clientId === 'dw.csc') {
      order.custom.Adyen_serviceChannel = 'CSC';
      var pt = opi.getPaymentTransaction();
      var id = pt && pt.getPaymentProcessor().getID();
      if (id === 'Adyen_Component') {
        var paymentLink = authorizeAdyenPayment(order, pt);
        if (paymentLink) {
          // Intercept the flow with throwing an error.
          // If not intercepted order will be placed and should be kept in CREATED state.
          return new Status(Status.ERROR, null, `Pending payment for order ${order.orderNo}. \n Payment link: ${paymentLink}`);
        }
        return new Status(Status.ERROR);
      }
    }
  } catch (e) {
    AdyenLogs.error_log(`Failed to authorize Adyen CSC payment for order ${order.orderNo}`, e);
    return new Status(Status.ERROR);
  }
  return new Status(Status.OK);
}
exports.authorize = authorizeCSC;