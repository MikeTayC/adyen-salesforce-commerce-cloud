'use strict';

var _excluded = ['isExpressPdp'];
function _objectWithoutPropertiesLoose(r, e) {
    if (null == r) return {};
    var t = {};
    for (var n in r)
        if ({}.hasOwnProperty.call(r, n)) {
            if (-1 !== e.indexOf(n)) continue;
            t[n] = r[n];
        }
    return t;
}
var BasketMgr = require('dw/order/BasketMgr');
var PaymentMgr = require('dw/order/PaymentMgr');
var Transaction = require('dw/system/Transaction');
var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var URLUtils = require('dw/web/URLUtils');
var Money = require('dw/value/Money');
var adyenCheckout = require('*/cartridge/adyen/scripts/payments/adyenCheckout');
var constants = require('*/cartridge/adyen/config/constants');
var collections = require('*/cartridge/scripts/util/collections');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var GiftCardsHelper = require('*/cartridge/adyen/utils/giftCardsHelper');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var { cancelPartialPaymentOrderHelper } = require('*/cartridge/adyen/scripts/partialPayments/cancelPartialPaymentOrder');
var failUnsuccessfulKlarnaInlineOrder = require('*/cartridge/adyen/utils/failUnsuccessfulKlarnaInlineOrder');
var expressMethods = [constants.PAYMENTMETHODS.APPLEPAY, constants.PAYMENTMETHODS.AMAZONPAY, constants.PAYMENTMETHODS.GOOGLEPAY];
function setBillingAndShippingAddress(reqDataObj, currentBasket) {
    var { billingAddress } = currentBasket;
    var { shippingAddress } = currentBasket.getDefaultShipment();
    Transaction.wrap(() => {
        if (!shippingAddress) {
            shippingAddress = currentBasket.getDefaultShipment().createShippingAddress();
        }
        if (!billingAddress) {
            billingAddress = currentBasket.createBillingAddress();
        }
    });
    var shopperDetails = reqDataObj.customer;
    Transaction.wrap(() => {
        billingAddress.setFirstName(shopperDetails.billingAddressDetails.firstName);
        billingAddress.setLastName(shopperDetails.billingAddressDetails.lastName);
        billingAddress.setPhone(shopperDetails.profile.phone);
        billingAddress.setAddress1(shopperDetails.billingAddressDetails.address1);
        billingAddress.setCity(shopperDetails.billingAddressDetails.city);
        billingAddress.setCountryCode(shopperDetails.billingAddressDetails.countryCode.value);
        billingAddress.setPostalCode(shopperDetails.billingAddressDetails.postalCode);
        if (shopperDetails.billingAddressDetails.address2) {
            billingAddress.setAddress2(shopperDetails.billingAddressDetails.address2);
        }
        if (shopperDetails.billingAddressDetails.stateCode) {
            billingAddress.setStateCode(shopperDetails.billingAddressDetails.stateCode);
        }
        currentBasket.setCustomerEmail(shopperDetails.profile.email);
        shippingAddress.setFirstName(shopperDetails.profile.firstName);
        shippingAddress.setLastName(shopperDetails.profile.lastName);
        shippingAddress.setPhone(shopperDetails.profile.phone);
        shippingAddress.setAddress1(shopperDetails.addressBook.preferredAddress.address1);
        shippingAddress.setCity(shopperDetails.addressBook.preferredAddress.city);
        shippingAddress.setCountryCode(shopperDetails.addressBook.preferredAddress.countryCode.value);
        shippingAddress.setPostalCode(shopperDetails.addressBook.preferredAddress.postalCode);
        if (shopperDetails.addressBook.preferredAddress.address2) {
            shippingAddress.setAddress2(shopperDetails.addressBook.preferredAddress.address2);
        }
        if (shopperDetails.addressBook.preferredAddress.stateCode) {
            shippingAddress.setStateCode(shopperDetails.addressBook.preferredAddress.stateCode);
        }
    });
}
function failOrder(order) {
    Transaction.wrap(() => {
        OrderMgr.failOrder(order, true);
    });
}
function handleGiftCardPayment(currentBasket, order) {
    var giftCards = currentBasket.custom && currentBasket.custom.adyenGiftCards ? JSON.parse(currentBasket.custom.adyenGiftCards) : null;
    if (giftCards) {
        var mainPaymentInstrument = order.getPaymentInstruments(AdyenHelper.getOrderMainPaymentInstrumentType(order))[0];
        giftCards.forEach((giftCard) => {
            var divideBy = AdyenHelper.getDivisorForCurrency(mainPaymentInstrument.paymentTransaction.getAmount());
            var amount = {
                value: giftCard.remainingAmount.value,
                currency: giftCard.remainingAmount.currency
            };
            var formattedAmount = new Money(amount.value, amount.currency).divide(divideBy);
            Transaction.wrap(() => {
                mainPaymentInstrument.paymentTransaction.setAmount(formattedAmount);
            });
            GiftCardsHelper.createGiftCardPaymentInstrument(giftCard, divideBy, order);
        });
    }
}
function handleCancellation(res, next, reqDataObj) {
    AdyenLogs.info_log(`Shopper cancelled paymentFromComponent transaction for order ${reqDataObj.merchantReference}`);
    var order = OrderMgr.getOrder(reqDataObj.merchantReference, reqDataObj.orderToken);
    // The order is already failed when the basket was restored from another tab
    if (((order || {}).status || {}).value === Order.ORDER_STATUS_CREATED) {
        failOrder(order);
    }
    var currentBasket = BasketMgr.getCurrentBasket();
    var giftCardsAdded =
        currentBasket && currentBasket.custom && currentBasket.custom.adyenGiftCards ? JSON.parse(currentBasket.custom.adyenGiftCards) : null;
    if (giftCardsAdded) {
        cancelPartialPaymentOrderHelper(currentBasket);
    }
    res.redirect(URLUtils.url('Checkout-Begin', 'stage', 'placeOrder'));
    return next();
}
function handleRefusedResultCode(result, reqDataObj, order) {
    AdyenLogs.error_log(`Payment refused for order ${order.orderNo}`, '');
    result.paymentError = true;

    // Decline flow for Amazonpay or Applepay is handled different from other Component PMs
    // Order needs to be failed here to handle decline flow.
    if (expressMethods.indexOf(reqDataObj.paymentMethod) > -1) {
        failOrder(order);
    }
}
function isExpressPayment(reqDataObj) {
    return reqDataObj.paymentType === 'express';
}
function handleExpressPayment(reqDataObj, currentBasket) {
    if (isExpressPayment(reqDataObj)) {
        setBillingAndShippingAddress(reqDataObj, currentBasket);
    }
}
function canSkipSummaryPage(reqDataObj) {
    return constants.CAN_SKIP_SUMMARY_PAGE.indexOf((reqDataObj.paymentMethod || {}).type) >= 0;
}
function handleKlarnaInlinePayment(result, reqDataObj) {
    var includesResult = reqDataObj.paymentMethod && reqDataObj.paymentMethod.type.includes('klarna');
    if (result.resultCode === constants.RESULTCODES.PENDING && includesResult && AdyenConfigs.getKlarnaInlineWidgetEnabled()) {
        session.privacy.attemptedKlarnaPayment = true;
    }
}

// Lets Checkout-Begin restore the basket if the shopper navigates
// back from the PayPal popup that iOS Safari opens as a new tab.
// Limited to PayPal: other component methods (QR codes, MB WAY) keep the order
// CREATED while the shopper is still paying, so restoring would fail it.
// Express PDP uses a temporary basket, so there is nothing to restore.
function cacheOrderForBasketRestore(req, order, reqDataObj, isExpressPdp) {
    if (isExpressPdp || (reqDataObj.paymentMethod || {}).type !== constants.PAYMENTMETHODS.PAYPAL) {
        return;
    }
    req.session.privacyCache.set('currentOrderNumber', order.orderNo);
    req.session.privacyCache.set('currentOrderToken', order.orderToken);
}

/**
 * Make a payment from inside a component, skipping the summary page. (paypal, QRcodes, MBWay)
 */
function paymentFromComponent(req, res, next) {
    try {
        failUnsuccessfulKlarnaInlineOrder();
        session.privacy.orderNo = null;
        var _JSON$parse = JSON.parse(req.form.data),
            { isExpressPdp } = _JSON$parse,
            reqDataObj = _objectWithoutPropertiesLoose(_JSON$parse, _excluded);
        if (reqDataObj.cancelTransaction) {
            return handleCancellation(res, next, reqDataObj);
        }
        var currentBasket = isExpressPdp ? BasketMgr.getTemporaryBasket(session.privacy.temporaryBasketId) : BasketMgr.getCurrentBasket();
        var paymentInstrument;
        Transaction.wrap(() => {
            collections.forEach(currentBasket.getPaymentInstruments(), (item) => {
                currentBasket.removePaymentInstrument(item);
            });
            var paymentInstrumentType = constants.METHOD_ADYEN_COMPONENT;
            paymentInstrument = currentBasket.createPaymentInstrument(paymentInstrumentType, currentBasket.totalGrossPrice);
            var { paymentProcessor } = PaymentMgr.getPaymentMethod(paymentInstrument.paymentMethod);
            paymentInstrument.paymentTransaction.paymentProcessor = paymentProcessor;
            paymentInstrument.custom.adyenMainPaymentInstrument = paymentInstrumentType;
            paymentInstrument.custom.adyenPaymentData = req.form.data;
            if (currentBasket.custom.partialPaymentOrderData) {
                paymentInstrument.custom.adyenPartialPaymentsOrder = currentBasket.custom.partialPaymentOrderData;
            }
        });
        handleExpressPayment(reqDataObj, currentBasket);
        var order = AdyenHelper.createOrder(currentBasket);
        session.privacy.orderNo = order.orderNo;
        cacheOrderForBasketRestore(req, order, reqDataObj, isExpressPdp);
        var result;
        Transaction.wrap(() => {
            result = adyenCheckout.createPaymentRequest({
                Order: order,
                OrderNo: order.orderNo,
                OrderToken: order.orderToken
            });
            order.custom.Adyen_eventCode = result.resultCode;
        });
        currentBasket.custom.amazonExpressShopperDetails = null;
        if (result.resultCode === constants.RESULTCODES.REFUSED) {
            handleRefusedResultCode(result, reqDataObj, order);
        }
        handleKlarnaInlinePayment(result, reqDataObj);
        handleGiftCardPayment(currentBasket, order);

        // Check if summary page can be skipped in case payment is already authorized
        result.skipSummaryPage = canSkipSummaryPage(reqDataObj);
        result.orderNo = order.orderNo;
        result.orderToken = order.orderToken;
        res.json(result);
    } catch (error) {
        AdyenLogs.fatal_log('Failed payment from component', error);
        setErrorType(error, res);
    }
    return next();
}
module.exports = paymentFromComponent;
