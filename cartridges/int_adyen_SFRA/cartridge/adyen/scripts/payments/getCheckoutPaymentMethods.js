'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var Locale = require('dw/util/Locale');
var Resource = require('dw/web/Resource');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var translations = require('*/cartridge/config/adyenTranslations');
var paymentMethodTitles = require('*/cartridge/config/adyenPaymentMethodTitles');
var paymentMethodDescriptions = require('*/cartridge/adyen/config/paymentMethodDescriptions');
var getPaymentMethods = require('*/cartridge/adyen/scripts/payments/adyenGetPaymentMethods');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var constants = require('*/cartridge/adyen/config/constants');
var getCountryCode = (currentBasket, locale) => {
    var countryCode;
    if (currentBasket) {
        var { shippingAddress } = currentBasket.getDefaultShipment();
        if (shippingAddress) {
            countryCode = shippingAddress.getCountryCode().value;
        }
    }
    return countryCode || Locale.getLocale(locale.id).country;
};
var getRemainingAmount = (currency, currentBasket) => {
    var partialPaymentOrderData = ((currentBasket || {}).custom || {}).partialPaymentOrderData;
    var remainingAmount = partialPaymentOrderData ? JSON.parse(partialPaymentOrderData).remainingAmount : null;
    if (remainingAmount) {
        var { value } = remainingAmount;
        if (value === undefined) {
            value = 1000;
        }
        return new dw.value.Money(value, currency);
    }
    return currentBasket && currentBasket.getTotalGrossPrice().isAvailable()
        ? AdyenHelper.getCurrencyValueForApi(currentBasket.getTotalGrossPrice())
        : new dw.value.Money(1000, currency);
};
var supportedStoredPaymentMethods = (storedPaymentMethods) =>
    AdyenConfigs.getAdyenRecurringPaymentsEnabled() && storedPaymentMethods
        ? storedPaymentMethods.filter(
              (pm) => pm.type === constants.SCHEME && pm.supportedShopperInteractions.includes(constants.SHOPPER_INTERACTIONS.ECOMMERCE)
          )
        : [];
var getDisclaimerFor = (key) => {
    var message = Resource.msg(`disclaimer.message.${key}`, 'bnpl', '');
    if (!message) {
        return null;
    }
    var linkText = Resource.msg(`disclaimer.linkText.${key}`, 'bnpl', '');
    var link = Resource.msg(`disclaimer.link.${key}`, 'bnpl', '');
    return Object.assign(
        {
            message
        },
        linkText && link
            ? {
                  linkText,
                  link
              }
            : {}
    );
};

// Resolves each BNPL txVariant to the most specific configured entry:
// exact txVariant -> method family -> generic 'bnpl'. Whole entries are
// resolved (not individual fields) so a specific message never gets a
// generic link.
var resolveBnplDisclaimer = (type) => {
    if (!type) {
        return null;
    }
    // Prefix match: covers klarna_*, facilypay_*, afterpaytouch, ... without
    // false positives such as 'oney' inside 'moneybookers'.
    var family = constants.BNPL_PAYMENT_METHODS.find((method) => type.indexOf(method) === 0);
    if (!family) {
        return null;
    }
    return getDisclaimerFor(type) || getDisclaimerFor(family) || getDisclaimerFor('bnpl');
};
var getBnplDisclaimers = (countryCode, paymentMethods) => {
    if (!constants.DISCLAIMER_COUNTRIES.includes(countryCode)) {
        return null;
    }
    var disclaimers = {};
    paymentMethods.forEach((_parameter) => {
        var { type } = _parameter === undefined ? {} : _parameter;
        var disclaimer = resolveBnplDisclaimer(type);
        if (disclaimer) {
            disclaimers[type] = disclaimer;
        }
    });
    return Object.keys(disclaimers).length ? disclaimers : null;
};
function getCheckoutPaymentMethods(req, res, next) {
    try {
        var currentBasket = BasketMgr.getCurrentBasket();
        var countryCode = getCountryCode(currentBasket, req.locale);
        var adyenURL = `${AdyenHelper.getLoadingContext()}images/logos/medium/`;
        var currency = currentBasket ? currentBasket.getTotalGrossPrice().currencyCode : session.currency.currencyCode;
        var paymentAmount = getRemainingAmount(currency, currentBasket);
        var shopperEmail = AdyenHelper.getCustomerEmail();
        var paymentMethods = getPaymentMethods.getMethods(paymentAmount, AdyenHelper.getCustomer(req.currentCustomer), countryCode, shopperEmail);
        var showFastlane =
            paymentMethods.paymentMethods.some((pm) => pm.type === constants.PAYMENTMETHODS.FASTLANE) && !req.currentCustomer.raw.authenticated;
        var sortedPaymentMethods = paymentMethods.paymentMethods.sort((a, b) => {
            if (a.type === constants.PAYMENTMETHODS.FASTLANE) return -1;
            if (b.type === constants.PAYMENTMETHODS.FASTLANE) return 1;
            return 0;
        });
        var disclaimerMessages = getBnplDisclaimers(countryCode, sortedPaymentMethods);
        res.json(
            Object.assign(
                {
                    AdyenPaymentMethods: {
                        paymentMethods: sortedPaymentMethods,
                        storedPaymentMethods: supportedStoredPaymentMethods(paymentMethods.storedPaymentMethods)
                    },
                    shopperEmail,
                    showFastlane,
                    imagePath: adyenURL,
                    adyenDescriptions: paymentMethodDescriptions,
                    adyenTranslations: translations,
                    adyenPaymentMethodTitles: paymentMethodTitles,
                    amount: {
                        value: paymentAmount.value,
                        currency
                    },
                    countryCode,
                    applicationInfo: AdyenHelper.getApplicationInfo()
                },
                disclaimerMessages
                    ? {
                          disclaimerMessages
                      }
                    : {}
            )
        );
    } catch (error) {
        AdyenLogs.fatal_log('Failed to fetch payment methods', error);
        setErrorType(error, res);
    }
    return next();
}
module.exports = getCheckoutPaymentMethods;
