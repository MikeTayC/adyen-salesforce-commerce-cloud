"use strict";

var Money = require('dw/value/Money');
var Transaction = require('dw/system/Transaction');
var TaxMgr = require('dw/order/TaxMgr');
var LineItemHelper = require('*/cartridge/adyen/utils/lineItemHelper');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var PAYPAL_ITEM_CATEGORY = ['PHYSICAL_GOODS', 'DIGITAL_GOODS', 'DONATION'];
function getLineItems({
  Order: order,
  Basket: basket
}, isExpress) {
  if (!(order || basket)) return null;
  var orderOrBasket = order || basket;
  var allLineItems = LineItemHelper.getAllLineItems(orderOrBasket.getAllLineItems());
  return allLineItems.filter(
  // For paypal express the shipping method could be changed in the paypal
  // light box and so the shipping line items are excluded in the initial payments call
  // as lineItems cannot be patched in /paypalUpdateOrder call.
  lineItem => !isExpress || !(lineItem instanceof dw.order.ShippingLineItem)).map(lineItem => {
    var lineItemObject = {};
    var description = LineItemHelper.getDescription(lineItem);
    var id = LineItemHelper.getId(lineItem);
    var quantity = LineItemHelper.getQuantity(lineItem);
    var itemAmount = LineItemHelper.getItemAmount(lineItem).divide(quantity);
    var vatAmount = LineItemHelper.getVatAmount(lineItem).divide(quantity);
    // eslint-disable-next-line
    if (lineItem.hasOwnProperty('category')) {
      if (PAYPAL_ITEM_CATEGORY.indexOf(lineItem.category) > -1) {
        lineItemObject.itemCategory = lineItem.category;
      }
    }
    lineItemObject.quantity = quantity;
    lineItemObject.description = description;
    lineItemObject.sku = id;
    lineItemObject.amountExcludingTax = itemAmount.getValue().toFixed();
    // For paypal express tax amount could change based on shipping Address
    // so the tax amount in lineItem is excluded in the initial /Payments call.
    // The final tax is passed as tax_total in /paypalUpdateOrder. On gross-price sites,
    // shipping tax is subtracted from tax_total to prevent double-counting.
    if (!isExpress) {
      lineItemObject.taxAmount = vatAmount.getValue().toFixed();
    }
    return lineItemObject;
  });
}

/**
 * @typedef {object} paypalShippingOption
 * @property {string} reference - shipping method id
 * @property {string} description - shipping method displayName
 * @property {('Shipping')} type
 * @property {{currencyCode: String, value: String}} amount
 *          - shipping cost for shipping method including tax
 * @property {boolean} selected - - shipping method is selected
 */

/**
 * @typedef {object} paypalUpdateOrderRequest
 * @property {String} pspReference - the pspReference returned from adyen /payments endpoint
 * @property {String} paymentData - encrypted payment data from paypal component
 * @property {{currencyCode: String, value: String}} amount
 *          - adjustedMerchandizeTotalGrossPrice + adjustedShippingTotalGrossPrice
 * @property {dw.util.ArrayList<paypalShippingOption>} deliveryMethods
 *          - list of paypalShippingOption
 */

/**
 * Returns applicable shipping methods(excluding store pickup methods)
 * for specific Shipment / ShippingAddress pair.
 * @param {String} pspReference - the pspReference returned from adyen /payments endpoint
 * @param {dw.order.basket} currentBasket - a shipment of the current basket
 * @param {dw.util.ArrayList<ApplicableShippingMethodModel>} currentShippingMethods
 *        - a shipment of the current basket
 * @param {String} paymentData - encrypted payment data from paypal component
 * @returns {paypalUpdateOrderRequest} - list of applicable shipping methods or null
 */
function createPaypalUpdateOrderRequest(pspReference, currentBasket, currentShippingMethods, paymentData) {
  var isGrossSite = TaxMgr.taxationPolicy === TaxMgr.TAX_POLICY_GROSS;
  var totalGrossPrice = {
    currency: currentBasket.currencyCode,
    value: AdyenHelper.getCurrencyValueForApi(currentBasket.getTotalGrossPrice()).value
  };

  // Validation rule: Original Amount + Shipping + Tax = New Amount
  // On gross sites, shipping costs already include tax, so we must subtract
  // the shipping tax from totalTax to prevent double-counting.
  // On net sites, shipping costs exclude tax, so totalTax is passed unchanged.
  var totalTaxValue;
  if (isGrossSite) {
    totalTaxValue = AdyenHelper.getCurrencyValueForApi(currentBasket.totalTax).value - AdyenHelper.getCurrencyValueForApi(currentBasket.shippingTotalTax).value;
  } else {
    totalTaxValue = AdyenHelper.getCurrencyValueForApi(currentBasket.totalTax).value;
  }
  var totalTax = {
    currency: currentBasket.currencyCode,
    value: totalTaxValue
  };

  // All delivery methods use the catalog shipping cost (gross on gross-price sites,
  // net on net-price sites). The selected method is determined by the shipment's
  // current shipping method, which is applied in shippingMethods.js before calling this function.
  var deliveryMethods = currentShippingMethods.map(shippingMethod => {
    var {
      currencyCode,
      value
    } = shippingMethod.shippingCost;
    var isSelected = shippingMethod.selected;
    return {
      reference: shippingMethod.ID,
      description: shippingMethod.displayName,
      type: 'Shipping',
      amount: {
        currency: currencyCode,
        value: AdyenHelper.getCurrencyValueForApi(new Money(value, currencyCode)).value
      },
      selected: isSelected
    };
  });

  // Ensure at least one method is selected
  var anySelected = deliveryMethods.some(method => method.selected);
  if (!anySelected && deliveryMethods.length > 0) {
    deliveryMethods[0].selected = true;
  }
  return {
    pspReference,
    paymentData,
    amount: totalGrossPrice,
    taxTotal: {
      amount: totalTax
    },
    deliveryMethods
  };
}

/**
 * sets Shipping and Billing address for the basket
 * @param {dw.order.Basket} currentBasket - the current basket
 * @param {object} shopperDetails - shopper details
 * @returns {undefined}
 */
function setBillingAndShippingAddress(currentBasket, shopperDetails) {
  var {
    billingAddress
  } = currentBasket;
  var {
    shippingAddress
  } = currentBasket.getDefaultShipment();
  Transaction.wrap(() => {
    if (!shippingAddress) {
      shippingAddress = currentBasket.getDefaultShipment().createShippingAddress();
    }
    if (!billingAddress) {
      billingAddress = currentBasket.createBillingAddress();
    }
  });
  Transaction.wrap(() => {
    billingAddress.setFirstName(shopperDetails.shopperName.firstName);
    billingAddress.setLastName(shopperDetails.shopperName.lastName);
    billingAddress.setAddress1(shopperDetails.billingAddress.street);
    billingAddress.setCity(shopperDetails.billingAddress.city);
    billingAddress.setPhone(shopperDetails.telephoneNumber);
    billingAddress.setPostalCode(shopperDetails.billingAddress.postalCode);
    billingAddress.setStateCode(shopperDetails.billingAddress.stateOrProvince);
    billingAddress.setCountryCode(shopperDetails.billingAddress.country);
    shippingAddress.setFirstName(shopperDetails.shippingAddress.firstName);
    if (shopperDetails.shippingAddress.lastName) {
      shippingAddress.setLastName(shopperDetails.shippingAddress.lastName);
    }
    shippingAddress.setAddress1(shopperDetails.shippingAddress.street);
    shippingAddress.setCity(shopperDetails.shippingAddress.city);
    shippingAddress.setPhone(shopperDetails.shippingAddress.telephoneNumber || shopperDetails.telephoneNumber);
    shippingAddress.setPostalCode(shopperDetails.shippingAddress.postalCode);
    shippingAddress.setStateCode(shopperDetails.shippingAddress.stateOrProvince);
    shippingAddress.setCountryCode(shopperDetails.shippingAddress.country);
    currentBasket.setCustomerEmail(shopperDetails.shopperEmail);
  });
}
module.exports = {
  createPaypalUpdateOrderRequest,
  getLineItems,
  setBillingAndShippingAddress
};