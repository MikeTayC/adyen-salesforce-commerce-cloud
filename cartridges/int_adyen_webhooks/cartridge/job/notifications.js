"use strict";

/* API Includes */
var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
// script includes
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var localeHelper = require('*/cartridge/adyen/utils/localeHelper');
var deleteCustomObjects = require('*/cartridge/deleteCustomObjects');
var objectsHandler = require('*/cartridge/handleCustomObject');

/**
 * Handles failed order scenarios
 * @param {Object} handlerResult - The result from the handler
 * @param {Object} order - The order object
 * @returns {boolean} True if processing should continue, false if should skip
 */
function handleFailedOrder(handlerResult, order) {
  if (!handlerResult.status || handlerResult.status === PIPELET_ERROR) {
    // Only CREATED orders can be failed
    if (!order || order.status.value !== dw.order.Order.ORDER_STATUS_CREATED) {
      return false;
    }
    // Refused payments which are made with using Adyen payment method are
    // handled when user is redirected back from Adyen HPP.
    // Here we shouldn't fail an order and send a notification
    Transaction.wrap(() => {
      OrderMgr.failOrder(order, true);
    });
    return false;
  }
  return true;
}

/**
 * Sends the order confirmation email in the locale of the order
 * @param {Object} order - The order object
 */
function sendOrderConfirmationEmail(order) {
  var localeId = localeHelper.resolveLocaleId(order.getCustomerLocaleID());
  var jobLocaleId = request.getLocale();
  try {
    // The email templates and resource bundles are resolved with the locale of
    // the current request, which in a job is the site default.
    if (!request.setLocale(localeId)) {
      AdyenLogs.warning_log(`Locale ${localeId} is not available for the confirmation email of order ${order.orderNo}`);
    }
    COHelpers.sendConfirmationEmail(order, localeId);
  } catch (e) {
    // A failing email should not stop the remaining notifications
    AdyenLogs.error_log(`Failed to send the confirmation email for order ${order.orderNo}`, e);
  } finally {
    request.setLocale(jobLocaleId);
  }
}

/**
 * Handles successful order processing
 * @param {Object} handlerResult - The result from the handler
 * @param {Object} order - The order object
 * @returns {boolean} True if processing should continue, false if should skip
 */
function handleSuccessfulOrder(handlerResult, order) {
  if (handlerResult.SkipOrder || handlerResult.Pending) {
    return false;
  }
  if (handlerResult.SubmitOrder) {
    sendOrderConfirmationEmail(order);
  }
  return true;
}

/**
 * Processes a single notification custom object
 * @param {Object} customObj - The custom object to process
 */
function processNotificationItem(customObj) {
  var handlerResult;
  Transaction.wrap(() => {
    handlerResult = objectsHandler.handle(customObj);
  });

  /*
    Sometimes order cannot be found in DWRE DB even if it exists there,
    in that case we shouldn't reply to Adyen that all was ok in order to get a new notification
  */
  var order = handlerResult.Order;
  if (!handleFailedOrder(handlerResult, order)) {
    return;
  }
  handleSuccessfulOrder(handlerResult, order);
}

/**
 * ProcessNotifications - search for custom objects that need
 *  to be processed and handle them to place or fail order
 */
function processNotifications(/* pdict */
) {
  var searchQuery = CustomObjectMgr.queryCustomObjects('adyenNotification', "custom.updateStatus = 'PROCESS'", null);
  AdyenLogs.info_log(`Process notifications start with count ${searchQuery.count}`);
  while (searchQuery.hasNext()) {
    var customObj = searchQuery.next();
    processNotificationItem(customObj);
  }
  AdyenLogs.info_log(`Process notifications finished with count ${searchQuery.count}`);
  searchQuery.close();
  return PIPELET_NEXT;
}

/**
 * Removes a single processed custom object
 * @param {Object} customObj - The custom object to remove
 */
function removeProcessedCustomObject(customObj) {
  Transaction.wrap(() => {
    deleteCustomObjects.remove(customObj);
  });
}

/**
 * cleanNotifications
 */
function clearNotifications(/* pdict */
) {
  var searchQuery = CustomObjectMgr.queryCustomObjects('adyenNotification', "custom.processedStatus = 'SUCCESS'", null);
  AdyenLogs.info_log(`Removing Processed Custom Objects start with count ${searchQuery.count}`);
  while (searchQuery.hasNext()) {
    var customObj = searchQuery.next();
    removeProcessedCustomObject(customObj);
  }
  AdyenLogs.info_log(`Removing Processed Custom Objects finished with count ${searchQuery.count}`);
  searchQuery.close();
  return PIPELET_NEXT;
}
function execute() {
  processNotifications();
  clearNotifications();
  return PIPELET_NEXT;
}
module.exports = {
  execute,
  processNotifications,
  clearNotifications
};