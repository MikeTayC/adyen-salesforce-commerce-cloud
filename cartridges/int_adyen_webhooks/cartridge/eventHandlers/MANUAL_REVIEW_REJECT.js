'use strict';

var Order = require('dw/order/Order');
var Transaction = require('dw/system/Transaction');
var OrderMgr = require('dw/order/OrderMgr');
var { isWebhookSuccessful } = require('*/cartridge/utils/webhookUtils');
function handle({ order, customObj }) {
    if (isWebhookSuccessful(customObj)) {
        order.trackOrderChange('Manual review is not accepted in Adyen Customer Area, failing the order');
        order.setPaymentStatus(Order.PAYMENT_STATUS_NOTPAID);
        Transaction.wrap(() => {
            OrderMgr.failOrder(order, false);
        });
    }
}
module.exports = {
    handle
};
