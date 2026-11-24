'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Currency = require('dw/util/Currency');
var URLUtils = require('dw/web/URLUtils');
var Bytes = require('dw/util/Bytes');
var MessageDigest = require('dw/crypto/MessageDigest');
var Encoding = require('dw/crypto/Encoding');
var CustomerMgr = require('dw/customer/CustomerMgr');
var Transaction = require('dw/system/Transaction');
var UUIDUtils = require('dw/util/UUIDUtils');
var ShippingMgr = require('dw/order/ShippingMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var StringUtils = require('dw/util/StringUtils');
var Money = require('dw/value/Money');
var BasketMgr = require('dw/order/BasketMgr');
var OrderMgr = require('dw/order/OrderMgr');
// script includes
var ShippingMethodModel = require('*/cartridge/models/shipping/shippingMethod');
var collections = require('*/cartridge/scripts/util/collections');
var constants = require('*/cartridge/adyen/config/constants');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var { sanitizeRequest } = require('*/cartridge/adyen/utils/checkoutRequestSanitizer');
var { AdyenError } = require('*/cartridge/adyen/logs/adyenError');
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
function parseErrorResponse(errorText) {
    try {
        return JSON.parse(errorText);
    } catch (e) {
        return null;
    }
}
function createServiceError(message, errorText) {
    var serviceError = new AdyenError(message);
    serviceError.isServiceError = true;
    serviceError.adyenErrorResponse = errorText ? parseErrorResponse(errorText) : null;
    return serviceError;
}

/* eslint no-var: off */
var adyenHelperObj = {
    // Create the service config used to make calls to the Adyen Checkout API (used for all services)
    getService(service, reqMethod) {
        if (reqMethod === undefined) {
            reqMethod = 'POST';
        }
        var adyenService = LocalServiceRegistry.createService(service, {
            createRequest(svc, args) {
                svc.setRequestMethod(reqMethod);
                if (args) {
                    return args;
                }
                return null;
            },
            parseResponse(svc, client) {
                return client;
            },
            filterLogMessage(msg) {
                return msg;
            }
        });
        AdyenLogs.info_log(`Successfully retrieve service with name ${service}`);
        return adyenService;
    },
    // returns SFCC customer object based on currentCustomer object
    // as retrieved from controller endpoint calls
    getCustomer(currentCustomer) {
        if (currentCustomer.profile) {
            return CustomerMgr.getCustomerByCustomerNumber(currentCustomer.profile.customerNo);
        }
        return null;
    },
    /**
     * Returns shippingCost for a specific Shipment / ShippingMethod pair including
     * the product level shipping cost if any.
     * On gross-price sites the amount includes tax (per SFCC ShippingCost.getAmount()
     * semantics); on net-price sites the amount excludes tax.
     * @param {dw.order.ShippingMethod} shippingMethod
     * @param {dw.order.Shipment} shipment
     * @returns {{currencyCode: String, value: String}}
     */
    getShippingCost(shippingMethod, shipment) {
        var shipmentShippingModel = ShippingMgr.getShipmentShippingModel(shipment);
        var shippingCost = shipmentShippingModel.getShippingCost(shippingMethod).getAmount();
        collections.forEach(shipment.getProductLineItems(), (lineItem) => {
            var product = lineItem.getProduct();
            var productQuantity = lineItem.getQuantity();
            var productShippingModel = ShippingMgr.getProductShippingModel(product);
            var productShippingCost = productShippingModel.getShippingCost(shippingMethod)
                ? productShippingModel.getShippingCost(shippingMethod).getAmount().multiply(productQuantity)
                : new Money(0, product.getPriceModel().getPrice().getCurrencyCode());
            shippingCost = shippingCost.add(productShippingCost);
        });
        return {
            value: shippingCost.getValue(),
            currencyCode: shippingCost.getCurrencyCode()
        };
    },
    /**
     * Returns applicable shipping methods for specific Shipment / ShippingAddress pair.
     * @param {dw.order.OrderAddress} address - the shipping address of the default shipment of the current basket
     * @param {dw.order.Shipment} shipment - a shipment of the current basket
     * @returns {dw.util.ArrayList<dw.order.ShippingMethod> | null} - list of applicable shipping methods or null
     */
    getShippingMethods(shipment, address) {
        if (!shipment) return null;
        var shipmentShippingModel = ShippingMgr.getShipmentShippingModel(shipment);
        var shippingMethods;
        if (address) {
            shippingMethods = shipmentShippingModel.getApplicableShippingMethods(address);
        } else {
            shippingMethods = shipmentShippingModel.getApplicableShippingMethods();
        }
        return shippingMethods;
    },
    /**
     * Returns shipment UUID for the shipment.
     * @param {dw.order.Shipment} shipment - a shipment of the current basket
     * @returns {String | null} - shipment UUID or null
     */
    getShipmentUUID(shipment) {
        if (!shipment) return null;
        return shipment.UUID;
    },
    /**
     * @typedef {object} ApplicableShippingMethodModel
     * @property {string|null} ID
     * @property {string|null} displayName
     * @property {string|null} estimatedArrivalTime
     * @property {boolean|null} default
     * @property {boolean|null} [selected]
     * @property {{currencyCode: String, value: String}} shippingCost
     * @property {string|null} shipmentUUID
     */

    /**
     * Returns applicable shipping methods(excluding store pickup methods) for specific Shipment / ShippingAddress pair.
     * @param {dw.order.OrderAddress} address - the shipping address of the default shipment of the current basket
     * @param {dw.order.Shipment} shipment - a shipment of the current basket
     * @returns {dw.util.ArrayList<ApplicableShippingMethodModel> | null} - list of applicable shipping methods or null
     */
    getApplicableShippingMethods(shipment, address) {
        var shippingMethods = adyenHelperObj.getShippingMethods(shipment, address);
        if (!shippingMethods) {
            return null;
        }

        // Filter out whatever the method associated with in store pickup
        var filteredMethods = [];
        collections.forEach(shippingMethods, (shippingMethod) => {
            if (!shippingMethod.custom.storePickupEnabled) {
                var shippingMethodModel = new ShippingMethodModel(shippingMethod, shipment);
                var shippingCost = adyenHelperObj.getShippingCost(shippingMethod, shipment);
                var shipmentUUID = adyenHelperObj.getShipmentUUID(shipment);
                filteredMethods.push(
                    Object.assign({}, shippingMethodModel, {
                        shippingCost,
                        shipmentUUID
                    })
                );
            }
        });
        return filteredMethods;
    },
    // get the URL for the checkout component based on the current Adyen component version
    getCheckoutUrl() {
        var checkoutUrl = this.getLoadingContext();
        return `${checkoutUrl}sdk/${constants.CHECKOUT_COMPONENT_VERSION}/adyen.js`;
    },
    // get the URL for the checkout component css based on the current Adyen component version
    getCheckoutCSS() {
        var checkoutCSS = this.getLoadingContext();
        return `${checkoutCSS}sdk/${constants.CHECKOUT_COMPONENT_VERSION}/adyen.css`;
    },
    // converts to a syntax-safe HTML string
    encodeHtml(str) {
        return StringUtils.encodeString(str, 0);
    },
    // get the current region-based checkout environment
    getCheckoutEnvironment() {
        var returnValue = '';
        switch (AdyenConfigs.getAdyenEnvironment()) {
            case constants.MODE.TEST:
                returnValue = constants.CHECKOUT_ENVIRONMENT_TEST;
                break;
            case constants.MODE.LIVE:
                var frontEndRegion = AdyenConfigs.getAdyenFrontendRegion();
                if (frontEndRegion === constants.FRONTEND_REGIONS.US) {
                    returnValue = constants.CHECKOUT_ENVIRONMENT_LIVE_US;
                    break;
                }
                if (frontEndRegion === constants.FRONTEND_REGIONS.AU) {
                    returnValue = constants.CHECKOUT_ENVIRONMENT_LIVE_AU;
                    break;
                }
                if (frontEndRegion === constants.FRONTEND_REGIONS.IN) {
                    returnValue = constants.CHECKOUT_ENVIRONMENT_LIVE_IN;
                    break;
                }
                if (frontEndRegion === constants.FRONTEND_REGIONS.APSE) {
                    returnValue = constants.CHECKOUT_ENVIRONMENT_LIVE_APSE;
                    break;
                }
                if (frontEndRegion === constants.FRONTEND_REGIONS.NEA) {
                    returnValue = constants.CHECKOUT_ENVIRONMENT_LIVE_NEA;
                    break;
                }
                returnValue = constants.CHECKOUT_ENVIRONMENT_LIVE_EU;
                break;
        }
        return returnValue;
    },
    getTerminalApiEnvironment() {
        var returnValue = '';
        switch (AdyenConfigs.getAdyenEnvironment()) {
            case constants.MODE.TEST:
                returnValue = constants.POS_ENVIRONMENT_TEST;
                break;
            case constants.MODE.LIVE:
                var terminalRegion = AdyenConfigs.getAdyenPosRegion();
                if (terminalRegion === constants.POS_REGIONS.US) {
                    returnValue = constants.POS_ENVIRONMENT_LIVE_US;
                    break;
                }
                if (terminalRegion === constants.POS_REGIONS.AU) {
                    returnValue = constants.POS_ENVIRONMENT_LIVE_AU;
                    break;
                }
                if (terminalRegion === constants.POS_REGIONS.APSE) {
                    returnValue = constants.POS_ENVIRONMENT_LIVE_APSE;
                    break;
                }
                if (terminalRegion === constants.POS_REGIONS.NEA) {
                    returnValue = constants.POS_ENVIRONMENT_LIVE_NEA;
                    break;
                }
                returnValue = constants.POS_ENVIRONMENT_LIVE_EU;
                break;
        }
        return returnValue;
    },
    // get the loading context based on the current environment (live or test)
    getLoadingContext() {
        return `https://checkoutshopper-${adyenHelperObj.getCheckoutEnvironment()}.adyen.com/checkoutshopper/`;
    },
    // get the hash used to verify redirect requests
    getAdyenHash(value, salt) {
        var data = value + salt;
        var digestSHA512 = new MessageDigest(MessageDigest.DIGEST_SHA_512);
        var signature = Encoding.toHex(digestSHA512.digestBytes(new Bytes(data, 'UTF-8')));
        return signature;
    },
    getBasketAmount() {
        var currentBasket = BasketMgr.getCurrentBasket();
        if (!currentBasket) {
            return;
        }
        var amount = {
            currency: currentBasket.currencyCode,
            value: this.getCurrencyValueForApi(currentBasket.getTotalGrossPrice()).value
        };
        return JSON.stringify(amount);
    },
    getCustomerEmail() {
        var currentBasket = BasketMgr.getCurrentBasket();
        return currentBasket ? currentBasket.customerEmail : '';
    },
    isAdyenGivingAvailable(order) {
        if (!order) {
            return false;
        }
        var paymentInstruments = order.getPaymentInstruments(adyenHelperObj.getOrderMainPaymentInstrumentType(order));
        if (!paymentInstruments.length) {
            return false;
        }
        var paymentInstrument = paymentInstruments[0];
        return AdyenConfigs.getAdyenGivingEnabled() && !!paymentInstrument.paymentTransaction.custom.Adyen_donationToken;
    },
    // gets the ID for ratePay using the custom preference and the encoded session ID
    getRatePayID: function getRatePayID() {
        var returnValue = {};
        var ratePayMerchantID = AdyenConfigs.getRatePayMerchantID();
        if (ratePayMerchantID) {
            returnValue.ratePayID = ratePayMerchantID;
        }
        var digestSHA512 = new MessageDigest(MessageDigest.DIGEST_SHA_512);
        returnValue.sessionID = Encoding.toHex(digestSHA512.digestBytes(new Bytes(session.sessionID, 'UTF-8')));
        session.privacy.ratePayFingerprint = returnValue.sessionID;
        return returnValue;
    },
    isOpenInvoiceMethod(paymentMethod) {
        return constants.OPEN_INVOICE_METHODS.some((method) => paymentMethod.indexOf(method) > -1);
    },
    isMolpayMethod(paymentMethod) {
        if (paymentMethod.indexOf('molpay') > -1) {
            return true;
        }
        return false;
    },
    isPayPalExpress(paymentMethod) {
        return paymentMethod.type === 'paypal' && paymentMethod.subtype === 'express';
    },
    // Get stored card token of customer saved card based on matched cardUUID
    getCardToken(cardUUID, customer) {
        var token = '';
        if (customer && customer.authenticated && cardUUID) {
            var wallet = customer.getProfile().getWallet();
            var paymentInstruments = wallet.getPaymentInstruments();
            var creditCardInstrument;
            var instrumentsIter = paymentInstruments.iterator();
            while (instrumentsIter.hasNext()) {
                creditCardInstrument = instrumentsIter.next();
                // find token ID exists for matching payment card
                if (creditCardInstrument.UUID.equals(cardUUID) && creditCardInstrument.getCreditCardToken()) {
                    token = creditCardInstrument.getCreditCardToken();
                    break;
                }
            }
        }
        return token;
    },
    // populates and returns the args paymentRequest with shopper information using the order contains in the args object itself
    createShopperObject(args) {
        var gender = 'UNKNOWN';
        if (args.paymentRequest.shopperName && args.paymentRequest.shopperName.gender) {
            gender = args.paymentRequest.shopperName.gender;
        }
        var defaultShipment;
        var shippingAddress;
        if (
            args.order &&
            (defaultShipment = args.order.getDefaultShipment()) &&
            (shippingAddress = defaultShipment.getShippingAddress()) &&
            shippingAddress.getPhone()
        ) {
            args.paymentRequest.telephoneNumber = args.order.getDefaultShipment().getShippingAddress().getPhone();
        }
        var customer = args.order.getCustomer();
        var profile = customer && customer.registered && customer.getProfile() ? customer.getProfile() : null;
        if (args.order.customerEmail) {
            args.paymentRequest.shopperEmail = args.order.customerEmail;
        }
        if (!args.order.customerEmail && profile && profile.getEmail()) {
            args.paymentRequest.shopperEmail = profile.getEmail();
        }
        var address = args.order.getBillingAddress() || args.order.getDefaultShipment().getShippingAddress();
        var shopperDetails = {
            firstName: (address || {}).firstName,
            gender,
            infix: '',
            lastName: (address || {}).lastName
        };
        args.paymentRequest.shopperName = shopperDetails;
        if (profile && profile.getCustomerNo()) {
            args.paymentRequest.shopperReference = profile.getCustomerNo();
        } else if (args.order.getCustomerNo()) {
            args.paymentRequest.shopperReference = args.order.getCustomerNo();
        }
        if (request.getLocale()) {
            args.paymentRequest.shopperLocale = request.getLocale();
        }
        args.paymentRequest.shopperIP = request.getHttpRemoteAddress();
        return args.paymentRequest;
    },
    // populates the paymentRequest with address information using the order and payment method and returns it
    createAddressObjects(order, paymentMethod, paymentRequest) {
        var { shippingAddress } = order.defaultShipment;
        paymentRequest.countryCode = shippingAddress.countryCode.value.toUpperCase();
        var shippingStreet = '';
        var shippingHouseNumberOrName = '';
        if (shippingAddress.address1) {
            shippingStreet = shippingAddress.address1;
            if (shippingAddress.address2) {
                shippingHouseNumberOrName = shippingAddress.address2;
                if (paymentMethod.indexOf('afterpaytouch') > -1) {
                    shippingHouseNumberOrName = '';
                    shippingStreet += ` ${shippingAddress.address2}`;
                }
            }
        } else {
            shippingStreet = 'N/A';
        }
        paymentRequest.deliveryAddress = {
            city: shippingAddress.city ? shippingAddress.city : 'N/A',
            country: shippingAddress.countryCode ? shippingAddress.countryCode.value.toUpperCase() : 'ZZ',
            houseNumberOrName: shippingHouseNumberOrName,
            postalCode: shippingAddress.postalCode ? shippingAddress.postalCode : '',
            // Required by the Adyen address model, so countries without a state still
            // need a placeholder.
            stateOrProvince: shippingAddress.stateCode ? shippingAddress.stateCode : 'N/A',
            street: shippingStreet
        };
        var billingAddress = order.getBillingAddress();
        var billingStreet = '';
        var billingHouseNumberOrName = '';
        if (billingAddress.address1) {
            billingStreet = billingAddress.address1;
            if (billingAddress.address2) {
                billingHouseNumberOrName = billingAddress.address2;
                if (paymentMethod.indexOf('afterpaytouch') > -1) {
                    billingHouseNumberOrName = '';
                    billingStreet += ` ${billingAddress.address2}`;
                }
            }
        } else {
            billingStreet = 'N/A';
        }
        paymentRequest.billingAddress = {
            city: billingAddress.city ? billingAddress.city : 'N/A',
            country: billingAddress.countryCode ? billingAddress.countryCode.value.toUpperCase() : 'ZZ',
            houseNumberOrName: billingHouseNumberOrName,
            postalCode: billingAddress.postalCode ? billingAddress.postalCode : '',
            stateOrProvince: billingAddress.stateCode ? billingAddress.stateCode : 'N/A',
            street: billingStreet
        };
        return paymentRequest;
    },
    setPaymentInstrumentFields(paymentInstrument, paymentRequest, adyenPaymentMethod) {
        try {
            if (!(paymentInstrument instanceof dw.order.OrderPaymentInstrument)) {
                return null;
            }
            var paymentMethodType = paymentRequest.paymentMethod.type;
            var isCardOrGiftcard = [constants.PAYMENTMETHODS.SCHEME, constants.PAYMENTMETHODS.GIFTCARD].indexOf(paymentMethodType) !== -1;
            var omsPaymentMethodField = `${constants.OMS_NAMESPACE}__Adyen_Payment_Method`;
            var componentType = adyenHelperObj.getAdyenComponentType(paymentMethodType);
            Transaction.wrap(() => {
                if (isCardOrGiftcard) {
                    // authorize passes no adyenPaymentMethod: keep the brand resolved at handle time
                    var cardPaymentMethod = adyenPaymentMethod || paymentInstrument.custom.adyenPaymentMethod || componentType;
                    paymentInstrument.custom.adyenPaymentMethod = cardPaymentMethod;
                    paymentInstrument.custom[omsPaymentMethodField] = cardPaymentMethod;
                } else {
                    if (empty(paymentInstrument.custom.adyenPaymentMethod)) {
                        paymentInstrument.custom.adyenPaymentMethod = componentType;
                    }
                    paymentInstrument.custom[omsPaymentMethodField] = componentType;
                }
                paymentInstrument.custom.Adyen_Payment_Method_Variant = paymentRequest.paymentMethod.type.toLowerCase();
                paymentInstrument.custom[`${constants.OMS_NAMESPACE}__Adyen_Payment_Method_Variant`] =
                    paymentRequest.paymentMethod.type.toLowerCase();
            });
        } catch (e) {
            AdyenLogs.error_log('Failed to set the payment instrument fields', e);
        }
    },
    // creates a request object to send to the Adyen Checkout API
    createAdyenRequestObject(orderNo, orderToken, paymentInstrument, customerEmail) {
        var jsonObject = JSON.parse(paymentInstrument.custom.adyenPaymentData);
        var filteredJson = adyenHelperObj.validateStateData(jsonObject);
        var { stateData } = filteredJson;

        // Add recurringProcessingModel in case shopper wants to save the card from checkout
        if (stateData.storePaymentMethod) {
            stateData.recurringProcessingModel = constants.RECURRING_PROCESSING_MODEL.CARD_ON_FILE;
        }
        if (stateData.paymentMethod && stateData.paymentMethod.storedPaymentMethodId) {
            stateData.recurringProcessingModel = constants.RECURRING_PROCESSING_MODEL.CARD_ON_FILE;
            stateData.shopperInteraction = constants.SHOPPER_INTERACTIONS.CONT_AUTH;
            var holderName = paymentInstrument.getCreditCardHolder ? paymentInstrument.getCreditCardHolder() : paymentInstrument.creditCardHolder;
            if (holderName) {
                stateData.paymentMethod.holderName = holderName;
            }
            if (customerEmail) {
                stateData.shopperEmail = customerEmail;
            }
        } else {
            stateData.shopperInteraction = constants.SHOPPER_INTERACTIONS.ECOMMERCE;
        }
        stateData.merchantAccount = AdyenConfigs.getAdyenMerchantAccount();
        stateData.reference = orderNo;
        stateData.returnUrl = adyenHelperObj.createRedirectUrl(paymentInstrument, orderNo, orderToken);
        stateData.applicationInfo = adyenHelperObj.getApplicationInfo();
        stateData.additionalData = {};
        return stateData;
    },
    /**
     * Returns unique hashed signature.
     * @param {dw.order.OrderPaymentInstrument} paymentInstrument - paymentInstrument for the current order or current basket.
     * @param {String} value - UUID to be hashed for creating signature.
     * @param {String} salt - order number for the current order or from createOrderNo() used as Salt for hash.
     * @returns {String} - returns hashed signature.
     */
    createSignature(paymentInstrument, value, salt) {
        var newSignature = adyenHelperObj.getAdyenHash(value, salt);
        Transaction.wrap(() => {
            paymentInstrument.paymentTransaction.custom.Adyen_merchantSig = newSignature;
        });
        return newSignature;
    },
    /**
     * Returns redirectURL with 'Adyen-ShowConfirmation' route and query params .
     * @param {dw.order.OrderPaymentInstrument} paymentInstrument - paymentInstrument for the current order or current basket
     * @param {String} orderNo - order number for the current order or from createOrderNo()
     * @param {String} [orderToken] - orderToken for current order if order exists
     * @returns {String<dw.web.URL>} - returns String representation of the redirectURL
     */
    createRedirectUrl(paymentInstrument, orderNo, orderToken) {
        if (!(paymentInstrument instanceof dw.order.OrderPaymentInstrument)) {
            return null;
        }
        var signature = adyenHelperObj.createSignature(paymentInstrument, UUIDUtils.createUUID(), orderNo);
        return URLUtils.https('Adyen-ShowConfirmation', 'merchantReference', orderNo, 'signature', signature, 'orderToken', orderToken).toString();
    },
    // adds 3DS2 fields to an Adyen Checkout payments Request
    add3DS2Data(jsonObject) {
        jsonObject.authenticationData = {
            threeDSRequestData: {
                nativeThreeDS: 'preferred'
            }
        };
        jsonObject.channel = 'web';
        var origin = `${request.getHttpProtocol()}://${request.getHttpHost()}`;
        jsonObject.origin = origin;
        return jsonObject;
    },
    getAdyenComponentType(paymentMethod) {
        var methodName;
        switch (paymentMethod) {
            case 'applepay':
                methodName = 'Apple Pay';
                break;
            case 'amazonpay':
                methodName = 'Amazon Pay';
                break;
            case 'paypal':
                methodName = 'PayPal';
                break;
            case 'googlepay':
                methodName = 'Google Pay';
                break;
            case 'fastlane':
                methodName = 'PayPal Fastlane';
                break;
            case 'payto':
                methodName = 'PayTo';
                break;
            default:
                methodName = paymentMethod;
        }
        return methodName;
    },
    getOrderMainPaymentInstrumentType(order) {
        var type = constants.METHOD_ADYEN_COMPONENT;
        collections.forEach(order.getPaymentInstruments(), (item) => {
            if (item.custom.adyenMainPaymentInstrument && item.custom.adyenMainPaymentInstrument.value) {
                type = (item.custom.adyenMainPaymentInstrument || {}).value;
            }
        });
        return type;
    },
    getPaymentInstrumentType(isCreditCard) {
        return isCreditCard ? PaymentInstrument.METHOD_CREDIT_CARD : constants.METHOD_ADYEN_COMPONENT;
    },
    // gets the Adyen card type name based on the SFCC card type name
    getSfccCardType(cardType) {
        var cardTypeMapping = require('*/cartridge/adyen/config/card-type-mapping.json');
        if (empty(cardType)) {
            throw new AdyenError('cardType argument is not passed to getSfccCardType function');
        }
        var brand = cardType.toLowerCase();
        // Adyen reports wallet transactions with a suffixed brand, e.g. visa_applepay
        var baseBrand = brand.replace(/_(applepay|googlepay|samsungpay)$/, '');
        var sfccCardType = cardTypeMapping[brand] || cardTypeMapping[baseBrand];
        if (!sfccCardType) {
            AdyenLogs.warning_log(`No SFCC card type mapping found for Adyen brand "${cardType}". Add it to card-type-mapping.json.`);
        }
        return sfccCardType || '';
    },
    // saves the payment details in the paymentInstrument's custom object
    // set custom payment method field to sync with OMS
    savePaymentDetails(paymentInstrument, order, result) {
        paymentInstrument.paymentTransaction.transactionID = result.pspReference;
        paymentInstrument.paymentTransaction.custom.Adyen_pspReference = result.pspReference;
        if (result.additionalData && result.additionalData.paymentMethod) {
            paymentInstrument.paymentTransaction.custom.Adyen_paymentMethod = result.additionalData.paymentMethod;
            order.custom.Adyen_paymentMethod = result.additionalData.paymentMethod;
        } else if (result.paymentMethod) {
            paymentInstrument.paymentTransaction.custom.Adyen_paymentMethod = result.paymentMethod.type;
            order.custom.Adyen_paymentMethod = result.paymentMethod.type;
        }

        // For authenticated shoppers we are setting the token on other place already
        // SFRA throws an error if you try to set token again that's why this check is added
        var tokenAlreadyExists = paymentInstrument.getCreditCardToken();
        if (!tokenAlreadyExists && result.additionalData && result.additionalData['recurring.recurringDetailReference']) {
            paymentInstrument.setCreditCardToken(result.additionalData['recurring.recurringDetailReference']);
        }
        paymentInstrument.paymentTransaction.custom.authCode = result.resultCode ? result.resultCode : '';
        order.custom.Adyen_value = '0';
        if (result.donationToken || (result.fullResponse || {}).donationToken) {
            paymentInstrument.paymentTransaction.custom.Adyen_donationToken = result.donationToken || result.fullResponse.donationToken;
        }
        // Save full response to transaction custom attribute
        paymentInstrument.paymentTransaction.custom.Adyen_log = JSON.stringify(result);
        return true;
    },
    getFirstTwoNumbersFromYear() {
        return Math.floor(new Date().getFullYear() / 100);
    },
    // converts the currency value for the Adyen Checkout API
    getCurrencyValueForApi(amount) {
        var currencyCode = Currency.getCurrency(amount.currencyCode) || session.currency.currencyCode;
        var digitsNumber = adyenHelperObj.getFractionDigits(currencyCode.toString());
        var value = Math.round(amount.multiply(10 ** digitsNumber).value); // eslint-disable-line no-restricted-properties
        return new dw.value.Money(value, currencyCode);
    },
    // get the fraction digits based on the currency code used to convert amounts of currency for the Adyen Checkout API
    getFractionDigits(currencyCode) {
        var format;
        var currency = currencyCode || session.currency.currencyCode;
        switch (currency) {
            case 'CVE':
            case 'DJF':
            case 'GNF':
            case 'IDR':
            case 'JPY':
            case 'KMF':
            case 'KRW':
            case 'PYG':
            case 'RWF':
            case 'UGX':
            case 'VND':
            case 'VUV':
            case 'XAF':
            case 'XOF':
            case 'XPF':
                format = 0;
                break;
            case 'BHD':
            case 'IQD':
            case 'JOD':
            case 'KWD':
            case 'LYD':
            case 'OMR':
            case 'TND':
                format = 3;
                break;
            default:
                format = 2;
                break;
        }
        return format;
    },
    getDivisorForCurrency(amount) {
        var fractionDigits = adyenHelperObj.getFractionDigits(amount.currencyCode);
        return Math.pow(10, fractionDigits);
    },
    getApplicationInfo() {
        var applicationInfo = {};
        applicationInfo.merchantApplication = {
            name: constants.MERCHANT_APPLICATION_NAME,
            version: constants.VERSION
        };
        applicationInfo.externalPlatform = {
            name: constants.EXTERNAL_PLATFORM_NAME,
            version: AdyenConfigs.getAdyenSFRAVersion(),
            integrator: AdyenConfigs.getSystemIntegratorName()
        };
        return applicationInfo;
    },
    isApplePay(paymentMethod) {
        return paymentMethod === constants.PAYMENTMETHODS.APPLEPAY;
    },
    // validates all fields in a state data object. Filters out all invalid fields
    validateStateData(stateData) {
        var validFields = [
            'paymentMethod',
            'billingAddress',
            'deliveryAddress',
            'riskData',
            'shopperName',
            'dateOfBirth',
            'telephoneNumber',
            'shopperEmail',
            'countryCode',
            'socialSecurityNumber',
            'browserInfo',
            'installments',
            'storePaymentMethod'
        ];
        var invalidFields = [];
        var filteredStateData = {};
        var stateDataKeys = Object.keys(stateData);
        for (var i = 0; i < stateDataKeys.length; i++) {
            var keyName = stateDataKeys[i];
            var includesInvalidField = validFields.indexOf(keyName) === -1;
            if (includesInvalidField) {
                invalidFields.push(keyName);
            } else {
                filteredStateData[keyName] = stateData[keyName];
            }
        }
        return {
            stateData: filteredStateData,
            invalidFields
        };
    },
    createAdyenCheckoutResponse(checkoutresponse) {
        if (
            [constants.RESULTCODES.AUTHORISED, constants.RESULTCODES.REFUSED, constants.RESULTCODES.ERROR, constants.RESULTCODES.CANCELLED].indexOf(
                checkoutresponse.resultCode
            ) !== -1
        ) {
            return {
                isFinal: true,
                isSuccessful: checkoutresponse.resultCode === constants.RESULTCODES.AUTHORISED,
                merchantReference: checkoutresponse.merchantReference
            };
        }
        if (
            [
                constants.RESULTCODES.REDIRECTSHOPPER,
                constants.RESULTCODES.IDENTIFYSHOPPER,
                constants.RESULTCODES.CHALLENGESHOPPER,
                constants.RESULTCODES.PRESENTTOSHOPPER,
                constants.RESULTCODES.PENDING
            ].indexOf(checkoutresponse.resultCode) !== -1
        ) {
            return {
                isFinal: false,
                action: checkoutresponse.action || checkoutresponse.fullResponse.action
            };
        }
        if (checkoutresponse.resultCode === constants.RESULTCODES.RECEIVED) {
            return {
                isFinal: false
            };
        }
        AdyenLogs.error_log('Unknown resultCode:', checkoutresponse.resultCode);
        return {
            isFinal: true,
            isSuccessful: false
        };
    },
    getPaymentMethodType(paymentMethod) {
        return paymentMethod.type === constants.ACTIONTYPES.GIFTCARD ? paymentMethod.brand : paymentMethod.type;
    },
    // SALE payment methods require payment transaction type to be Capture
    setPaymentTransactionType(paymentInstrument, paymentMethod) {
        var salePaymentMethods = AdyenConfigs.getAdyenSalePaymentMethods();
        var paymentMethodType = this.getPaymentMethodType(paymentMethod);
        if (salePaymentMethods.indexOf(paymentMethodType) > -1) {
            Transaction.wrap(() => {
                paymentInstrument.getPaymentTransaction().setType(dw.order.PaymentTransaction.TYPE_CAPTURE);
            });
        }
    },
    isIntermediateResultCode(orderNo) {
        var order = OrderMgr.getOrder(orderNo);
        var paymentInstrument = order.getPaymentInstruments(adyenHelperObj.getOrderMainPaymentInstrumentType(order))[0];
        var resultCode = paymentInstrument.paymentTransaction.custom.authCode;
        return resultCode === constants.RESULTCODES.PENDING || resultCode === constants.RESULTCODES.RECEIVED;
    },
    executeCall(serviceType, requestObject, checkoutAttemptID) {
        if (checkoutAttemptID === undefined) {
            checkoutAttemptID = '';
        }
        var service = this.getService(serviceType);
        if (service === null) {
            throw createServiceError(`Could not create ${serviceType} service object`);
        }
        var serviceApiVersion = service.getURL().replace('[CHECKOUT_API_VERSION]', constants.CHECKOUT_API_VERSION);
        service.setURL(serviceApiVersion);
        if (AdyenConfigs.getAdyenEnvironment() === constants.MODE.LIVE) {
            var livePrefix = AdyenConfigs.getLivePrefix();
            var serviceUrl = service.getURL().replace('[YOUR_LIVE_PREFIX]', livePrefix);
            service.setURL(serviceUrl);
        }
        var maxRetries = constants.MAX_API_RETRIES;
        var apiKey = AdyenConfigs.getAdyenApiKey();
        var uuid = UUIDUtils.createUUID();
        service.addHeader('Content-type', 'application/json');
        service.addHeader('charset', 'UTF-8');
        service.addHeader('X-API-KEY', apiKey);
        service.addHeader('Idempotency-Key', uuid);
        var requestBody = JSON.stringify(sanitizeRequest(requestObject));
        var callResult;
        // retry the call until we reach max retries OR the callresult is OK
        for (var nrRetries = 0; nrRetries < maxRetries && !(callResult && callResult.isOk()); nrRetries++) {
            callResult = service.call(requestBody);
        }
        if (!callResult.isOk()) {
            throw createServiceError(
                `${serviceType} service call error code${callResult.getError().toString()} Error => ResponseStatus: ${callResult.getStatus()} | ResponseErrorText: ${callResult.getErrorMessage()} | ResponseText: ${callResult.getMsg()}`,
                callResult.getErrorMessage()
            );
        }
        var resultObject = callResult.object;
        if (!resultObject || !resultObject.getText()) {
            throw createServiceError(`No correct response from ${serviceType} service call`);
        }
        return JSON.parse(resultObject.getText());
    },
    createOrder(currentBasket) {
        if (currentBasket.custom && currentBasket.custom.adyenGiftCards) {
            var giftCardsOrderNo = currentBasket.custom.adyenGiftCardsOrderNo;
            return Transaction.wrap(function () {
                return OrderMgr.createOrder(currentBasket, giftCardsOrderNo);
            });
        } else if (session.privacy.orderNo) {
            return Transaction.wrap(function () {
                return OrderMgr.createOrder(currentBasket, session.privacy.orderNo);
            });
        } else {
            return COHelpers.createOrder(currentBasket);
        }
    }
};
module.exports = adyenHelperObj;
