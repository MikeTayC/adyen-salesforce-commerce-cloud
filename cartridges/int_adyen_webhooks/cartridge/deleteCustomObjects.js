'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');

// script include
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
function remove(co) {
    AdyenLogs.info_log(`Remove CO object with merchantReference ${co.custom.merchantReference} and pspReferenceNumber ${co.custom.pspReference}`);
    try {
        CustomObjectMgr.remove(co);
    } catch (error) {
        AdyenLogs.error_log(`Error occured during delete CO, ID: ${co.custom.orderId}, erorr message ${error.message}`, error);
    }
}
function handle(orderID) {
    var queryString = `custom.orderId LIKE '${orderID}*'`;
    var searchQuery = CustomObjectMgr.queryCustomObjects('adyenNotification', queryString, null);
    if (searchQuery.count > 0) {
        AdyenLogs.debug_log(`Removing related Custom Objects with merchantReference ${orderID} with count ${searchQuery.count}`);
    }
    while (searchQuery.hasNext()) {
        var co = searchQuery.next();
        remove(co);
    }
    searchQuery.close();
    return PIPELET_NEXT;
}
function execute(args) {
    return handle(args.orderID);
}
module.exports = {
    execute,
    handle,
    remove
};
