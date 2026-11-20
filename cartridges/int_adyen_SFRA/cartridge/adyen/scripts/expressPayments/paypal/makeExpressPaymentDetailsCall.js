"use strict";

var URLUtils = require('dw/web/URLUtils');
var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var BasketMgr = require('dw/order/BasketMgr');
var adyenCheckout = require('*/cartridge/adyen/scripts/payments/adyenCheckout');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var hooksHelper = require('*/cartridge/scripts/helpers/hooks');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var {
  AdyenError
} = require('*/cartridge/adyen/logs/adyenError');

/**
 * Validates basket products haven't changed
 * @param {dw.order.Basket} currentBasket - the current basket
 * @throws {AdyenError} if basket products have changed
 */
function validateBasketProducts(currentBasket) {
  var productLines = currentBasket.getAllProductLineItems().toArray();
  var productQuantity = currentBasket.getProductQuantityTotal();
  var hashedProducts = AdyenHelper.getAdyenHash(productLines, productQuantity);
  if (hashedProducts !== currentBasket.custom.adyenProductLineItems) {
    throw new AdyenError('Basket products changed, cannot complete transaction');
  }
}

/**
 * Validates the order using hooks
 * @param {dw.order.Basket} currentBasket - the current basket
 * @throws {AdyenError} if validation fails
 */
function validateOrder(currentBasket) {
  var validationOrderStatus = hooksHelper('app.validate.order', 'validateOrder', currentBasket,
  // eslint-disable-next-line global-require
  require('*/cartridge/scripts/hooks/validateOrder').validateOrder);
  if (validationOrderStatus.error) {
    throw new AdyenError(validationOrderStatus.message);
  }
}

/**
 * Creates order from basket
 * @param {dw.order.Basket} currentBasket - the current basket
 * @returns {dw.order.Order} the created order
 * @throws {AdyenError} if order creation fails
 */
function createOrderFromBasket(currentBasket) {
  var order = null;
  Transaction.wrap(() => {
    order = OrderMgr.createOrder(currentBasket, session.privacy.paypalExpressOrderNo);
  });
  if (!order) {
    throw new AdyenError('Order could not be created for paypal express');
  }
  return order;
}
/*
 * Makes a payment details call to Adyen to confirm the current status of a payment.
   It is currently used only for PayPal Express Flow
 */
function makeExpressPaymentDetailsCall(req, res, next) {
  try {
    var request = JSON.parse(req.form.data);
    var {
      isExpressPdp
    } = request || {};
    var currentBasket = isExpressPdp ? BasketMgr.getTemporaryBasket(session.privacy.temporaryBasketId) : BasketMgr.getCurrentBasket();
    validateBasketProducts(currentBasket);
    validateOrder(currentBasket);
    var order = createOrderFromBasket(currentBasket);
    var response = adyenCheckout.doPaymentsDetailsCall(request.data);
    response.orderNo = order.orderNo;
    response.orderToken = order.orderToken;
    // Storing the paypal express response to make use of show confirmation logic
    Transaction.wrap(() => {
      order.custom.Adyen_paypalExpressResponse = JSON.stringify(response);
    });
    res.json({
      orderNo: response.orderNo,
      orderToken: response.orderToken
    });
    return next();
  } catch (error) {
    AdyenLogs.error_log('Could not verify express /payment/details:', error);
    setErrorType(error, res, {
      redirectUrl: URLUtils.url('Error-ErrorCode', 'err', 'general').toString()
    });
    return next();
  }
}
module.exports = makeExpressPaymentDetailsCall;