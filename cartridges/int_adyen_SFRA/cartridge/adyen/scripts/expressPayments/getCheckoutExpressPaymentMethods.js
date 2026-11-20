'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var Locale = require('dw/util/Locale');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var translations = require('*/cartridge/config/adyenTranslations');
var paymentMethodDescriptions = require('*/cartridge/adyen/config/paymentMethodDescriptions');
var getPaymentMethods = require('*/cartridge/adyen/scripts/payments/adyenGetPaymentMethods');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var constants = require('*/cartridge/adyen/config/constants');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var getAmount = (currency, currentBasket) =>
    currentBasket && currentBasket.getTotalGrossPrice().isAvailable()
        ? AdyenHelper.getCurrencyValueForApi(currentBasket.getTotalGrossPrice())
        : new dw.value.Money(1000, currency);
var getExpressPaymentMethods = (expressPaymentMethods) => {
    var paymentMethodOrder = AdyenConfigs.getExpressPaymentsOrder() || '';
    return Object.keys(expressPaymentMethods)
        .filter((item) => expressPaymentMethods[item])
        .sort((a, b) => paymentMethodOrder.indexOf(a) - paymentMethodOrder.indexOf(b));
};
function getCheckoutExpressPaymentMethods(req, res, next) {
    try {
        var _expressPaymentMethod, _expressPaymentMethod2, _expressPaymentMethod3;
        var currentBasket = BasketMgr.getCurrentBasket();
        var countryCode = Locale.getLocale(req.locale.id).country;
        var adyenURL = `${AdyenHelper.getLoadingContext()}images/logos/medium/`;
        var currency = currentBasket ? currentBasket.getTotalGrossPrice().currencyCode : session.currency.currencyCode;
        var paymentAmount = getAmount(currency, currentBasket);
        var shopperEmail = AdyenHelper.getCustomerEmail();
        var cachedExpressPaymentMethods = req.session.privacyCache.get(`expressPaymentMethods_${countryCode}`);
        var paymentMethods = cachedExpressPaymentMethods
            ? JSON.parse(cachedExpressPaymentMethods)
            : getPaymentMethods.getMethods(paymentAmount, AdyenHelper.getCustomer(req.currentCustomer), countryCode, shopperEmail, [
                  constants.PAYMENTMETHODS.APPLEPAY,
                  constants.PAYMENTMETHODS.AMAZONPAY,
                  constants.PAYMENTMETHODS.GOOGLEPAY,
                  constants.PAYMENTMETHODS.PAYPAL
              ]);
        req.session.privacyCache.set(`expressPaymentMethods_${countryCode}`, JSON.stringify(paymentMethods));
        var expressPaymentMethodsPdp =
            ((_expressPaymentMethod = {}),
            (_expressPaymentMethod[constants.PAYMENTMETHODS.APPLEPAY] = !!AdyenConfigs.isApplePayExpressOnPdpEnabled()),
            (_expressPaymentMethod[constants.PAYMENTMETHODS.GOOGLEPAY] = !!AdyenConfigs.isGooglePayExpressOnPdpEnabled()),
            (_expressPaymentMethod[constants.PAYMENTMETHODS.PAYPAL] = !!AdyenConfigs.isPayPalExpressOnPdpEnabled()),
            _expressPaymentMethod);
        var expressPaymentMethodsShipping =
            ((_expressPaymentMethod2 = {}),
            (_expressPaymentMethod2[constants.PAYMENTMETHODS.APPLEPAY] = !!AdyenConfigs.isApplePayExpressOnShippingPageEnabled()),
            (_expressPaymentMethod2[constants.PAYMENTMETHODS.GOOGLEPAY] = !!AdyenConfigs.isGooglePayExpressOnShippingPageEnabled()),
            (_expressPaymentMethod2[constants.PAYMENTMETHODS.PAYPAL] = !!AdyenConfigs.isPayPalExpressOnShippingPageEnabled()),
            _expressPaymentMethod2);
        var expressPaymentMethodsCart =
            ((_expressPaymentMethod3 = {}),
            (_expressPaymentMethod3[constants.PAYMENTMETHODS.APPLEPAY] = !!AdyenConfigs.isApplePayExpressEnabled()),
            (_expressPaymentMethod3[constants.PAYMENTMETHODS.AMAZONPAY] = !!AdyenConfigs.isAmazonPayExpressEnabled()),
            (_expressPaymentMethod3[constants.PAYMENTMETHODS.GOOGLEPAY] = !!AdyenConfigs.isGooglePayExpressEnabled()),
            (_expressPaymentMethod3[constants.PAYMENTMETHODS.PAYPAL] = !!AdyenConfigs.isPayPalExpressEnabled()),
            _expressPaymentMethod3);
        res.json({
            AdyenPaymentMethods: paymentMethods,
            imagePath: adyenURL,
            adyenDescriptions: paymentMethodDescriptions,
            adyenTranslations: translations,
            amount: {
                value: paymentAmount.value,
                currency
            },
            countryCode,
            applicationInfo: AdyenHelper.getApplicationInfo(),
            cartExpressMethods: getExpressPaymentMethods(expressPaymentMethodsCart),
            pdpExpressMethods: getExpressPaymentMethods(expressPaymentMethodsPdp),
            shippingExpressMethods: getExpressPaymentMethods(expressPaymentMethodsShipping)
        });
    } catch (error) {
        AdyenLogs.fatal_log('Failed to fetch express payment methods', error);
        setErrorType(error, res);
    }
    return next();
}
module.exports = getCheckoutExpressPaymentMethods;
