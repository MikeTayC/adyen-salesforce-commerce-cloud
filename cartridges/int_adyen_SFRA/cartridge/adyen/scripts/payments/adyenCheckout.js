'use strict';

/* API Includes */
var Resource = require('dw/web/Resource');
var Order = require('dw/order/Order');
var StringUtils = require('dw/util/StringUtils');
var hooksHelper = require('*/cartridge/scripts/helpers/hooks');
/* Script Modules */
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var RiskDataHelper = require('*/cartridge/adyen/utils/riskDataHelper');
var AdyenGetOpenInvoiceData = require('*/cartridge/adyen/scripts/payments/adyenGetOpenInvoiceData');
var adyenLevelTwoThreeData = require('*/cartridge/adyen/scripts/payments/adyenLevelTwoThreeData');
var constants = require('*/cartridge/adyen/config/constants');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var paypalHelper = require('*/cartridge/adyen/utils/paypalHelper');
var { AdyenError } = require('*/cartridge/adyen/logs/adyenError');
var preAuthorizationHook = require('*/cartridge/adyen/scripts/hooks/payment/preAuthorizationHandling');
var dcapHelper = require('*/cartridge/adyen/utils/dcapHelper');

// eslint-disable-next-line complexity
function doPaymentsCall(order, paymentInstrument, paymentRequest) {
    var paymentResponse = {};
    var errorMessage = '';
    if (!(paymentRequest && paymentRequest.amount && paymentRequest.amount.value)) {
        throw new AdyenError('Zero amount not accepted');
    }
    var transactionAmount = AdyenHelper.getCurrencyValueForApi(((paymentInstrument || {}).paymentTransaction || {}).amount).getValueOrNull();
    var partialPaymentsOrder =
        paymentInstrument && paymentInstrument.custom && paymentInstrument.custom.adyenPartialPaymentsOrder
            ? JSON.parse(paymentInstrument.custom.adyenPartialPaymentsOrder)
            : null;
    if (partialPaymentsOrder) {
        if ((partialPaymentsOrder.remainingAmount || {}).value !== ((paymentRequest || {}).amount || {}).value) {
            throw new AdyenError('Amounts dont match');
        }
    } else if (transactionAmount !== ((paymentRequest || {}).amount || {}).value) {
        throw new AdyenError('Amounts dont match');
    }
    // Pre-auth hook
    var preAuthResult = hooksHelper('app.payment.pre.auth', 'preAuthorization', paymentRequest, preAuthorizationHook.preAuthorization);
    if (preAuthResult && preAuthResult.error) {
        return preAuthResult;
    }
    dcapHelper.warnForMissingDcapFields(paymentRequest);
    var responseObject = AdyenHelper.executeCall(constants.SERVICE.PAYMENT, paymentRequest);
    paymentResponse.fullResponse = responseObject;
    paymentResponse.redirectObject = responseObject.action ? responseObject.action : '';
    paymentResponse.resultCode = responseObject.resultCode;
    paymentResponse.pspReference = responseObject.pspReference ? responseObject.pspReference : '';
    paymentResponse.adyenAmount = paymentRequest.amount.value;
    paymentResponse.decision = 'ERROR';
    if (responseObject.additionalData) {
        paymentInstrument.paymentTransaction.custom.Adyen_paymentMethod = responseObject.additionalData.paymentMethod
            ? responseObject.additionalData.paymentMethod
            : null;
    }
    var acceptedResultCodes = [
        constants.RESULTCODES.AUTHORISED,
        constants.RESULTCODES.PENDING,
        constants.RESULTCODES.RECEIVED,
        constants.RESULTCODES.REDIRECTSHOPPER
    ];
    var presentToShopperResultCodes = [constants.RESULTCODES.PRESENTTOSHOPPER];
    var refusedResultCodes = [constants.RESULTCODES.CANCELLED, constants.RESULTCODES.ERROR, constants.RESULTCODES.REFUSED];
    var { resultCode } = paymentResponse;
    // Check the response object from /payment call
    if (acceptedResultCodes.indexOf(resultCode) !== -1) {
        paymentResponse.decision = 'ACCEPT';
    } else if (presentToShopperResultCodes.indexOf(resultCode) !== -1) {
        paymentResponse.decision = 'ACCEPT';
        if (responseObject.action) {
            paymentInstrument.custom.adyenAction = JSON.stringify(responseObject.action);
        }
    } else {
        paymentResponse.decision = 'REFUSED';
        order.setPaymentStatus(Order.PAYMENT_STATUS_NOTPAID);
        order.setExportStatus(Order.EXPORT_STATUS_NOTEXPORTED);
        errorMessage =
            refusedResultCodes.indexOf(resultCode) !== -1
                ? Resource.msg('confirm.error.declined', 'checkout', null)
                : Resource.msg('confirm.error.unknown', 'checkout', null);
        if (responseObject.refusalReason) {
            errorMessage += ` (${responseObject.refusalReason})`;
        }
        paymentResponse.adyenErrorMessage = errorMessage;
        AdyenLogs.info_log('Payment result: Refused');
    }
    return paymentResponse;
}

// Service errors carry the raw Adyen response (pspReference, errorCode, ...),
// so only its human-readable message may reach the shopper. Any other error
// that is not an AdyenError is unexpected and its message stays in the logs.
function getShopperErrorMessage(error) {
    var genericMessage = Resource.msg('confirm.error.declined', 'checkout', null);
    var responseMessage = ((error || {}).adyenErrorResponse || {}).message;
    if (typeof responseMessage === 'string' && responseMessage) {
        return responseMessage;
    }
    if (error && error.isServiceError) {
        return genericMessage;
    }
    if (error instanceof AdyenError) {
        return error.message;
    }
    return genericMessage;
}

// eslint-disable-next-line complexity
function createPaymentRequest(args) {
    var order = args.Order;
    var orderNumber = args.OrderNo;
    var orderToken = args.OrderToken;
    var { paymentInstrument } = order;

    // Create request object with payment details
    var paymentRequest = AdyenHelper.createAdyenRequestObject(orderNumber, orderToken, paymentInstrument, order.getCustomerEmail());
    // Set payment instrument fields
    AdyenHelper.setPaymentInstrumentFields(paymentInstrument, paymentRequest);
    var paymentMethodType = paymentRequest.paymentMethod.type;
    paymentRequest = AdyenHelper.add3DS2Data(paymentRequest);
    // Add Risk data
    if (AdyenConfigs.getAdyenBasketFieldsEnabled()) {
        paymentRequest.additionalData = RiskDataHelper.createBasketContentFields(order);
    }

    // L2/3 Data
    if (AdyenConfigs.getAdyenLevel23DataEnabled() && constants.L23_PAYMENT_METHODS.some((pm) => paymentMethodType.indexOf(pm) > -1)) {
        var enhancedSchemeData = adyenLevelTwoThreeData.getLineItems(args);
        if ((((enhancedSchemeData || {}).levelTwoThree || {}).itemDetailLines || {}).length > 0) {
            paymentRequest.enhancedSchemeData = enhancedSchemeData;
        }
    }

    // Add installments
    if (AdyenConfigs.getAdyenInstallmentsEnabled() && AdyenConfigs.getCreditCardInstallments()) {
        var numOfInstallments = (JSON.parse(paymentInstrument.custom.adyenPaymentData).installments || {}).value;
        if (numOfInstallments !== undefined) {
            paymentRequest.installments = {
                value: numOfInstallments
            };
        }
    }
    var value = AdyenHelper.getCurrencyValueForApi(paymentInstrument.paymentTransaction.amount).getValueOrNull();
    var currency = paymentInstrument.paymentTransaction.amount.currencyCode;
    // Add partial payments order if applicable
    if (paymentInstrument.custom.adyenPartialPaymentsOrder) {
        var adyenPartialPaymentsOrder = JSON.parse(paymentInstrument.custom.adyenPartialPaymentsOrder);
        if (value === adyenPartialPaymentsOrder.amount.value && currency === adyenPartialPaymentsOrder.amount.currency) {
            paymentRequest.order = adyenPartialPaymentsOrder.order;
            paymentRequest.amount = adyenPartialPaymentsOrder.remainingAmount;
        } else {
            throw new AdyenError('Cart has been edited after applying a gift card');
        }
    } else {
        paymentRequest.amount = {
            currency,
            value
        };
    }

    // Create billing and delivery address objects for new orders,
    // no address fields for credit cards through My Account
    paymentRequest = AdyenHelper.createAddressObjects(order, paymentMethodType, paymentRequest);

    // Create shopper data fields
    paymentRequest = AdyenHelper.createShopperObject({
        order,
        paymentRequest
    });
    if (session.privacy.adyenFingerprint && paymentMethodType.indexOf('riverty') === -1) {
        paymentRequest.deviceFingerprint = session.privacy.adyenFingerprint;
    }
    // Set open invoice data
    if (AdyenHelper.isOpenInvoiceMethod(paymentRequest.paymentMethod.type)) {
        args.addTaxPercentage = true;
        if (paymentRequest.paymentMethod.type.indexOf('klarna') > -1) {
            args.addTaxPercentage = false;
            var address = order.getBillingAddress();
            var shippingMethod = (order.getDefaultShipment() || {}).shippingMethod;
            var otherDeliveryAddress = {
                shipping_method: (shippingMethod || {}).displayName,
                shipping_type: (shippingMethod || {}).description,
                first_name: address.firstName,
                last_name: address.lastName,
                street_address: address.address1,
                street_number: address.address2,
                postal_code: address.postalCode,
                city: address.city,
                country: address.countryCode.value
            };
            // openinvoicedata.merchantData holds merchant data.
            // It takes data in a Base64 encoded string.
            paymentRequest.additionalData['openinvoicedata.merchantData'] = StringUtils.encodeBase64(JSON.stringify(otherDeliveryAddress));
        }
        paymentRequest.lineItems = AdyenGetOpenInvoiceData.getLineItems(args);
        if (paymentMethodType.indexOf('ratepay') > -1 && session.privacy.ratePayFingerprint) {
            paymentRequest.deviceFingerprint = session.privacy.ratePayFingerprint;
        }
    }
    paymentRequest.shopperConversionId = session.sessionID.slice(0, 200);

    // add line items for paypal
    if (paymentRequest.paymentMethod.type.indexOf('paypal') > -1) {
        paymentRequest.lineItems = paypalHelper.getLineItems(args);
    }

    // riverty requires subtype redirect
    if (paymentRequest.paymentMethod.type.indexOf('riverty') > -1) {
        paymentRequest.paymentMethod.subtype = 'redirect';
    }
    var isCashApp = paymentMethodType === constants.PAYMENTMETHODS.CASHAPP;
    var tokenisationEnabled = AdyenConfigs.getAdyenTokenisationEnabled();

    // Set tokenisation
    // Cash App is excluded: its recurring details (onFileGrantId, cashtag) have to be
    // granted by the shopper in the component, so the component state decides whether
    // this payment tokenises. createAdyenRequestObject already applies CardOnFile then.
    if (tokenisationEnabled && !isCashApp) {
        paymentRequest.storePaymentMethod = true;
        paymentRequest.recurringProcessingModel = constants.RECURRING_PROCESSING_MODEL.CARD_ON_FILE;
    }
    if (isCashApp && paymentRequest.storePaymentMethod) {
        var hasOnFileDetails = (paymentRequest.paymentMethod || {}).onFileGrantId && (paymentRequest.paymentMethod || {}).cashtag;
        if (!tokenisationEnabled || !hasOnFileDetails || !paymentRequest.shopperReference) {
            AdyenLogs.warning_log('Cash App payment cannot be tokenised, falling back to a one-time payment');
            delete paymentRequest.storePaymentMethod;
            delete paymentRequest.recurringProcessingModel;
        }
    }
    AdyenHelper.setPaymentTransactionType(paymentInstrument, paymentRequest.paymentMethod);
    try {
        return doPaymentsCall(order, paymentInstrument, paymentRequest);
    } catch (error) {
        AdyenLogs.error_log('Payment call failed:', error);
        return {
            error: true,
            adyenErrorMessage: getShopperErrorMessage(error)
        };
    }
}
function doPaymentsDetailsCall(paymentDetailsRequest) {
    return AdyenHelper.executeCall(constants.SERVICE.PAYMENTDETAILS, paymentDetailsRequest);
}
function doCheckBalanceCall(checkBalanceRequest) {
    return AdyenHelper.executeCall(constants.SERVICE.CHECKBALANCE, checkBalanceRequest);
}
function doCancelPartialPaymentOrderCall(cancelOrderRequest) {
    return AdyenHelper.executeCall(constants.SERVICE.CANCELPARTIALPAYMENTORDER, cancelOrderRequest);
}
function doCreatePartialPaymentOrderCall(partialPaymentRequest) {
    return AdyenHelper.executeCall(constants.SERVICE.PARTIALPAYMENTSORDER, partialPaymentRequest);
}
function doPaypalUpdateOrderCall(paypalUpdateOrderRequest) {
    return AdyenHelper.executeCall(constants.SERVICE.PAYPALUPDATEORDER, paypalUpdateOrderRequest);
}
module.exports = {
    createPaymentRequest,
    doPaymentsCall,
    doPaymentsDetailsCall,
    doCheckBalanceCall,
    doCancelPartialPaymentOrderCall,
    doCreatePartialPaymentOrderCall,
    doPaypalUpdateOrderCall
};
