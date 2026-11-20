"use strict";

/* API Includes */
var PaymentInstrument = require('dw/order/PaymentInstrument');
var Transaction = require('dw/system/Transaction');
var collections = require('*/cartridge/scripts/util/collections');
var constants = require('*/cartridge/adyen/config/constants');

/* Script Modules */
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var getPaymentMethods = require('*/cartridge/adyen/scripts/payments/adyenGetPaymentMethods');
function getOneClickPaymentMethods(customer) {
  var amount = new dw.value.Money(0, session.currency.currencyCode);
  var {
    storedPaymentMethods
  } = getPaymentMethods.getMethods(amount, customer, '');
  var oneClickPaymentMethods = [];
  if (storedPaymentMethods) {
    storedPaymentMethods.forEach(storedPaymentMethod => {
      var indexOfResult = storedPaymentMethod && storedPaymentMethod.supportedShopperInteractions.indexOf('Ecommerce');
      if ((storedPaymentMethod || {}).supportedShopperInteractions && indexOfResult > -1) {
        oneClickPaymentMethods.push(storedPaymentMethod);
      }
    });
  }
  return oneClickPaymentMethods;
}

/* eslint-disable */
function updateSavedCards(args) {
  var customer = args.CurrentCustomer;
  var profile;
  if (!(customer && (profile = customer.getProfile()) && profile.getWallet())) {
    throw new Error('Error while updating saved cards, could not get customer data');
  }
  if (AdyenConfigs.getAdyenRecurringPaymentsEnabled()) {
    var oneClickPaymentMethods = getOneClickPaymentMethods(customer);
    // To make it compatible with upgrade from older versions (<= 19.2.2),
    // first delete payment instruments with METHOD_CREDIT_CARD
    var savedCreditCards = customer.getProfile().getWallet().getPaymentInstruments(PaymentInstrument.METHOD_CREDIT_CARD);
    var savedCreditCardsComponent = customer.getProfile().getWallet().getPaymentInstruments(constants.METHOD_ADYEN_COMPONENT);
    Transaction.wrap(() => {
      // remove all current METHOD_CREDIT_CARD PaymentInstruments
      collections.forEach(savedCreditCards, savedCreditCard => {
        customer.getProfile().getWallet().removePaymentInstrument(savedCreditCard);
      });
      // remove all current METHOD_ADYEN_COMPONENT PaymentInstruments
      collections.forEach(savedCreditCardsComponent, savedCreditCard => {
        customer.getProfile().getWallet().removePaymentInstrument(savedCreditCard);
      });

      // Create from existing cards a paymentInstrument
      oneClickPaymentMethods && oneClickPaymentMethods.forEach(payment => {
        var expiryMonth = payment.expiryMonth ? payment.expiryMonth : '';
        var expiryYear = payment.expiryYear ? payment.expiryYear : '';
        var holderName = payment.holderName ? payment.holderName : '';
        var lastFour = payment.lastFour ? payment.lastFour : '';
        var number = lastFour ? new Array(12 + 1).join('*') + lastFour : '';
        var token = payment.id;
        var cardType = payment.brand ? AdyenHelper.getSfccCardType(payment.brand) : '';

        // if we have everything we need, create a new payment instrument
        if (expiryMonth && expiryYear && number && token && cardType && holderName) {
          var newCreditCard = customer.getProfile().getWallet().createPaymentInstrument(constants.METHOD_ADYEN_COMPONENT);
          newCreditCard.setCreditCardExpirationMonth(Number(expiryMonth));
          newCreditCard.setCreditCardExpirationYear(Number(expiryYear));
          newCreditCard.setCreditCardType(cardType);
          newCreditCard.setCreditCardHolder(holderName);
          newCreditCard.setCreditCardNumber(number);
          newCreditCard.setCreditCardToken(token);
        }
      });
    });
  }
  return {
    error: false
  };
}
module.exports = {
  updateSavedCards
};