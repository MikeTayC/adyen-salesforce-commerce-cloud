"use strict";

var BasketMgr = require('dw/order/BasketMgr');
var URLUtils = require('dw/web/URLUtils');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var paypalHelper = require('*/cartridge/adyen/utils/paypalHelper');
function submitCustomer(req, res, next) {
  var stage = 'shipping';
  if (req.form.fastlaneShopperDetails && !req.currentCustomer.raw.authenticated) {
    try {
      var currentBasket = BasketMgr.getCurrentBasket();
      var fastlaneShopperDetails = JSON.parse(req.form.fastlaneShopperDetails);
      if (currentBasket) {
        paypalHelper.setBillingAndShippingAddress(currentBasket, fastlaneShopperDetails);
        stage = 'payment';
      }
    } catch (error) {
      AdyenLogs.error_log('Failed to set billing and shipping address for fastlane', error);
    }
  }
  res.setViewData({
    fastlaneReturnUrl: URLUtils.url('Checkout-Begin', 'stage', stage).toString()
  });
  return next();
}
module.exports = submitCustomer;