"use strict";

var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
function failUnsuccessfulKlarnaInlineOrder() {
  if (session.privacy.attemptedKlarnaPayment && session.privacy.orderNo) {
    var order = OrderMgr.getOrder(session.privacy.orderNo);
    Transaction.wrap(() => {
      OrderMgr.failOrder(order, true);
      session.privacy.attemptedKlarnaPayment = null;
      session.privacy.orderNo = null;
    });
  }
}
module.exports = failUnsuccessfulKlarnaInlineOrder;