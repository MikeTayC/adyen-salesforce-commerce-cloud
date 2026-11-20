"use strict";

// script include
var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var constants = require('*/cartridge/adyen/config/constants');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var {
  AdyenError
} = require('*/cartridge/adyen/logs/adyenError');
function getActiveCampaigns() {
  try {
    // This will be fixed on API level, replace needs to be removed once fixed
    var currentLocale = request.getLocale().replace('_', '-');
    var requestObject = {
      merchantAccount: AdyenConfigs.getAdyenMerchantAccount(),
      currency: session.currency.currencyCode,
      locale: currentLocale
    };
    var response = AdyenHelper.executeCall(constants.SERVICE.ADYENDONATIONCAMPAIGNS, requestObject);
    return response;
  } catch (error) {
    AdyenLogs.error_log('/donationCampaigns call failed:', error);
    return {
      error: true
    };
  }
}

// eslint-disable-next-line complexity
function donate(donationReference, donationAmount, orderToken) {
  if (session.privacy.orderNo !== donationReference) {
    throw new AdyenError('Donation reference is invalid');
  }
  var order = OrderMgr.getOrder(donationReference, orderToken);
  var orderAmount = AdyenHelper.getCurrencyValueForApi(order.getTotalGrossPrice());
  var paymentInstrument = order.getPaymentInstruments(AdyenHelper.getOrderMainPaymentInstrumentType(order))[0];
  var donationToken = paymentInstrument.paymentTransaction.custom.Adyen_donationToken;
  var originalReference = paymentInstrument.paymentTransaction.custom.Adyen_pspReference;
  var campaignsResponse = getActiveCampaigns();
  if ((campaignsResponse || {}).error || !(campaignsResponse && campaignsResponse.donationCampaigns && campaignsResponse.donationCampaigns.length)) {
    throw new AdyenError('Donation campaigns are not available');
  }
  var donationCampaign = campaignsResponse.donationCampaigns[0];
  var donationCampaignId = donationCampaign.id;
  var donationCampaignType = (donationCampaign.donation || {}).type;
  var requestObject = {
    merchantAccount: AdyenConfigs.getAdyenMerchantAccount(),
    donationCampaignId,
    amount: donationAmount,
    reference: `${AdyenConfigs.getAdyenMerchantAccount()}-${donationReference}`,
    donationOriginalPspReference: originalReference,
    donationToken
  };
  if (donationCampaignType === 'roundup') {
    var {
      maxRoundupAmount
    } = donationCampaign.donation;
    var roundUpAmount = maxRoundupAmount - orderAmount % maxRoundupAmount;
    if (roundUpAmount !== parseInt(donationAmount.value, 10)) {
      throw new AdyenError('Donation amount does not match the roundup amount');
    }
  }
  var response = AdyenHelper.executeCall(constants.SERVICE.ADYENGIVING, requestObject);
  Transaction.wrap(() => {
    order.custom.Adyen_donationAmount = JSON.stringify(donationAmount);
    // Donation token is deleted in case the donation is completed once
    if (response.status === constants.DONATION_RESULT.COMPLETED) {
      paymentInstrument.paymentTransaction.custom.Adyen_donationToken = null;
    }
  });
  return response;
}
function donation(req, res, next) {
  try {
    var {
      orderNo,
      orderToken
    } = req.form;
    var donationAmount = {
      value: req.form.amountValue,
      currency: req.form.amountCurrency
    };
    var donationResult = donate(orderNo, donationAmount, orderToken);
    res.json(donationResult.response);
  } catch (error) {
    AdyenLogs.error_log('/donations call failed:', error);
    setErrorType(error, res);
  }
  return next();
}
module.exports = {
  getActiveCampaigns,
  donate,
  donation
};