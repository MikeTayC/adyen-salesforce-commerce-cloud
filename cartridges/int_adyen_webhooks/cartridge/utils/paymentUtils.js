"use strict";

var PaymentMgr = require('dw/order/PaymentMgr');
var Order = require('dw/order/Order');
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
var constants = require('*/cartridge/utils/constants');

/**
 * Checks Adyen payment instruments and updates Adyen_log if found.
 * @param {Object} paymentInstruments - The payment instruments collection
 * @param {Object} customObj - The custom object containing Adyen_log
 * @returns {boolean} - True if any Adyen instrument was found
 */
function handleAdyenPaymentInstruments(paymentInstruments, customObj) {
  var foundAdyen = false;
  Object.values(paymentInstruments).forEach(pi => {
    var methodMatch = constants.ADYEN_METHODS.includes(pi.paymentMethod);
    var processor = PaymentMgr.getPaymentMethod(pi.getPaymentMethod()).getPaymentProcessor().ID;
    var processorMatch = constants.ADYEN_PROCESSORS.includes(processor);
    if (methodMatch || processorMatch) {
      foundAdyen = true;
      pi.paymentTransaction.custom.Adyen_log = customObj.custom.Adyen_log;
      pi.paymentTransaction.custom.Adyen_merchantSig = null;
    }
  });
  return foundAdyen;
}

/**
 * Places an order which gets exported to OMS
 * @param {dw.order.Order} order - The order to place
 * @returns {Object} Result of placing the order
 */
function placeOrder(order) {
  var fraudDetectionStatus = {
    status: 'success'
  };
  // Only created orders can be placed
  if (order.status.value === Order.ORDER_STATUS_CREATED) {
    var placeOrderResult = COHelpers.placeOrder(order, fraudDetectionStatus);
    return placeOrderResult;
  }
  return {
    error: true
  };
}
module.exports = {
  handleAdyenPaymentInstruments,
  placeOrder
};