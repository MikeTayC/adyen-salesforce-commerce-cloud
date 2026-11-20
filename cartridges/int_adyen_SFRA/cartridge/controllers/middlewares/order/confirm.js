"use strict";

var OrderMgr = require('dw/order/OrderMgr');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var adyenGiving = require('*/cartridge/adyen/scripts/donations/adyenGiving');

// order-confirm is POST in SFRA v6.0.0. orderID and orderToken are contained in form.
// This was a GET call with a querystring containing ID & token in earlier versions.
function getOrderId(req) {
  return req.form && req.form.orderID ? req.form.orderID : req.querystring.ID;
}
function getOrderToken(req) {
  return req.form && req.form.orderToken ? req.form.orderToken : req.querystring.token;
}
function handleAdyenGiving(req, res) {
  var clientKey = AdyenConfigs.getAdyenClientKey();
  var environment = AdyenHelper.getCheckoutEnvironment();
  var campaignsResponse = adyenGiving.getActiveCampaigns();
  var campaign = ((campaignsResponse || {}).donationCampaigns || {})[0];
  if (!campaign) {
    return;
  }
  var {
    nonprofitUrl,
    logoUrl,
    bannerUrl,
    termsAndConditionsUrl
  } = campaign;
  var donationProperties = JSON.stringify(campaign.donation);
  var nonprofitName = encodeURI(campaign.nonprofitName);
  var nonprofitDescription = encodeURI(campaign.nonprofitDescription);
  var orderToken = getOrderToken(req);
  var viewData = res.getViewData();
  viewData.adyen = {
    clientKey,
    environment,
    adyenGivingAvailable: true,
    donationProperties,
    nonprofitName,
    nonprofitDescription,
    nonprofitUrl,
    logoUrl,
    bannerUrl,
    termsAndConditionsUrl,
    orderToken
  };
  res.setViewData(viewData);
}
function confirm(req, res, next) {
  var orderId = getOrderId(req);
  var orderToken = getOrderToken(req);
  if (orderId && orderToken) {
    var order = OrderMgr.getOrder(orderId, orderToken);
    if (AdyenHelper.isAdyenGivingAvailable(order)) {
      handleAdyenGiving(req, res);
    }
  }
  return next();
}
module.exports = confirm;