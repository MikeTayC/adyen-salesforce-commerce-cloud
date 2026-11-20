"use strict";

var PaymentMgr = require('dw/order/PaymentMgr');
var adyenTerminalApi = require('*/cartridge/adyen/scripts/pos/adyenTerminalApi');
var constants = require('*/cartridge/adyen/config/constants');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
function getConnectedTerminals(req, res, next) {
  try {
    var requestObject = {};
    var getTerminalRequest = {};
    var {
      storeId
    } = JSON.parse(req.form.data);
    var activatedStores = AdyenConfigs.getAdyenActiveStoreId();
    getTerminalRequest.merchantAccount = AdyenConfigs.getAdyenMerchantAccount();
    getTerminalRequest.store = storeId;
    requestObject.request = getTerminalRequest;
    if (PaymentMgr.getPaymentMethod(constants.METHOD_ADYEN_POS).isActive() && activatedStores.includes(storeId)) {
      var response = adyenTerminalApi.executeCall(constants.SERVICE.CONNECTEDTERMINALS, requestObject);
      res.json(Object.assign({}, response));
    }
  } catch (error) {
    AdyenLogs.fatal_log('/getConnectedTerminals call failed', error);
    setErrorType(error, res);
  }
  return next();
}
module.exports = getConnectedTerminals;