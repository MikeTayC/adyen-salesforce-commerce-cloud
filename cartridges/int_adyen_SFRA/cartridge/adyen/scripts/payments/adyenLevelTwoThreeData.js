"use strict";

var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var LineItemHelper = require('*/cartridge/adyen/utils/lineItemHelper');

// eslint-disable-next-line complexity
function getShopperReference(orderOrBasket) {
  var customer = orderOrBasket.getCustomer();
  var isRegistered = customer && customer.registered;
  var profile = isRegistered && customer.getProfile();
  var profileCustomerNo = profile && profile.getCustomerNo();
  var orderNo = profileCustomerNo || orderOrBasket.getCustomerNo();
  return orderNo || customer.getID() || 'no-unique-ref';
}
function getDiscountAmount(lineItem, quantity) {
  if (!LineItemHelper.isProductLineItem(lineItem)) return null;
  var {
    basePrice,
    adjustedPrice
  } = lineItem;
  if (!basePrice || !adjustedPrice) return null;
  // Total line discount = (per-unit basePrice * quantity) - adjustedPrice line total.
  var baseTotal = basePrice.multiply(quantity);
  if (baseTotal.value <= adjustedPrice.value) return null;
  return parseFloat(AdyenHelper.getCurrencyValueForApi(baseTotal.subtract(adjustedPrice)).value.toFixed());
}
function collectShippingLineItems(shipments) {
  var shippingLineItems = [];
  for (var i = 0; i < shipments.length; i++) {
    var shipmentLineItems = shipments[i].getShippingLineItems().toArray();
    for (var j = 0; j < shipmentLineItems.length; j++) {
      shippingLineItems.push(shipmentLineItems[j]);
    }
  }
  return shippingLineItems;
}
function buildItemDetailLine(unitPrice, quantity, totalAmount, commodityCode, description, id, discountAmount) {
  return Object.assign({
    unitPrice,
    totalAmount,
    quantity,
    unitOfMeasure: 'EAC'
  }, commodityCode && {
    commodityCode
  }, description && {
    // eslint-disable-next-line no-control-regex
    description: description.substring(0, 26).replace(/[^\x00-\x7F]/g, '')
  }, id && {
    productCode: id.substring(0, 12)
  }, discountAmount && {
    discountAmount
  });
}
function processLineItem(acc, lineItem) {
  var description = LineItemHelper.getDescription(lineItem);
  var id = LineItemHelper.getId(lineItem);
  var quantity = parseFloat(LineItemHelper.getQuantity(lineItem)) || 1;
  var lineAmount = LineItemHelper.getItemAmount(lineItem);
  var vatAmount = LineItemHelper.getVatAmount(lineItem);
  var discountAmount = getDiscountAmount(lineItem, quantity);
  var commodityCode = AdyenConfigs.getAdyenLevel23CommodityCode();
  // Derive unitPrice from totalAmount = quantity * unitPrice - discountAmount.
  var totalAmount = parseFloat(lineAmount.value.toFixed());
  var unitPrice = parseFloat(((totalAmount + (discountAmount || 0)) / quantity).toFixed());
  acc.itemDetailLines.push(buildItemDetailLine(unitPrice, quantity, totalAmount, commodityCode, description, id, discountAmount));
  acc.totalTaxAmount += parseFloat(vatAmount.value.toFixed());
  return acc;
}
function getLineItems({
  Order: order,
  Basket: basket
}) {
  if (!(order || basket)) return null;
  var orderOrBasket = order || basket;
  var productLineItems = orderOrBasket.getProductLineItems().toArray();
  var shipments = orderOrBasket.getShipments().toArray();
  var shippingLineItems = collectShippingLineItems(shipments);
  var allLineItems = productLineItems.concat(shippingLineItems);
  var shopperReference = getShopperReference(orderOrBasket);
  return {
    levelTwoThree: allLineItems.reduce(processLineItem, {
      customerReferenceNumber: shopperReference.substring(0, 25),
      totalTaxAmount: 0.0,
      itemDetailLines: []
    })
  };
}
module.exports.getLineItems = getLineItems;