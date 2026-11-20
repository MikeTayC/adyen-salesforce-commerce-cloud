"use strict";

var BasketMgr = require('dw/order/BasketMgr');
var OrderMgr = require('dw/order/OrderMgr');
var URLUtils = require('dw/web/URLUtils');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var {
  AdyenError
} = require('*/cartridge/adyen/logs/adyenError');
function validateBasketAmount(currentBasket) {
  if (!currentBasket || currentBasket.totalGrossPrice <= 0) {
    throw new AdyenError('Cannot complete a payment with an amount lower or equal to zero');
  }
}

// eslint-disable-next-line complexity
function validatePaymentDataFromRequest(req, res, next) {
  try {
    var requestData = req.form && req.form.data ? JSON.parse(req.form.data) : null;
    if (requestData && requestData.cancelTransaction) {
      return next();
    }
    var {
      isExpressPdp
    } = requestData || {};
    var currentBasketOrOrder = isExpressPdp ? BasketMgr.getTemporaryBasket(session.privacy.temporaryBasketId) : BasketMgr.getCurrentBasket();
    if (!currentBasketOrOrder && session.privacy.orderNo) {
      currentBasketOrOrder = OrderMgr.getOrder(session.privacy.orderNo);
    }
    validateBasketAmount(currentBasketOrOrder);
    return next();
  } catch (e) {
    AdyenLogs.fatal_log('Error occurred:', e.message);
    setErrorType(e, res);
    return res.redirect(URLUtils.url('Error-ErrorCode', 'err', 'general'));
  }
}
module.exports = validatePaymentDataFromRequest;