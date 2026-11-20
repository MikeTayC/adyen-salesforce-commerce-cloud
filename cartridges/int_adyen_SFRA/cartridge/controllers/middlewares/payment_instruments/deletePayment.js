"use strict";

var CustomerMgr = require('dw/customer/CustomerMgr');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var {
  deleteRecurringPayment
} = require('*/cartridge/adyen/scripts/payments/adyenDeleteRecurringPayment');
function deletePayment(req, res, next) {
  var payment = res.getViewData();
  if (payment) {
    var customer = CustomerMgr.getCustomerByCustomerNumber(req.currentCustomer.profile.customerNo);
    var tokenToDelete = AdyenHelper.getCardToken(payment.UUID, customer);
    if (tokenToDelete) {
      deleteRecurringPayment({
        Customer: customer,
        RecurringDetailReference: tokenToDelete
      });
    }
  }
  return next();
}
module.exports = deletePayment;