"use strict";

var ProductMgr = require('dw/catalog/ProductMgr');
var Resource = require('dw/web/Resource');
var priceHelper = require('*/cartridge/scripts/helpers/pricing');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var {
  AdyenError
} = require('*/cartridge/adyen/logs/adyenError');

/**
 * Validate product exists and is available
 */
function validateProduct(pid) {
  if (!pid) {
    return {
      error: true
    };
  }
  var product = ProductMgr.getProduct(pid);
  if (!product) {
    return {
      error: true
    };
  }
  return {
    product
  };
}

/**
 * Check if product has variants
 */
function hasVariants(product) {
  return (product.master || product.variationGroup) && product.variationModel.variants.length > 0;
}

/**
 * Find first available variant
 */
function findAvailableVariant(variants) {
  for (var i = 0; i < variants.length; i++) {
    var variant = variants[i];
    if (variant.availabilityModel.availability > 0) {
      return variant;
    }
  }
  return variants[0];
}

/**
 * Get appropriate product for pricing (handle variants)
 */
function getProductForPricing(product) {
  if (hasVariants(product)) {
    var [variants] = [product.variationModel.variants];
    return findAvailableVariant(variants);
  }
  return product;
}

/**
 * Check if product has tiered pricing
 */
function hasTieredPricing(priceTable) {
  return priceTable && priceTable.quantities && priceTable.quantities.length > 1;
}

/**
 * Find quantity tier for given quantity
 */
function findQuantityTier(quantities, qty) {
  var selectedQuantity = null;
  for (var i = 0; i < quantities.length; i++) {
    var tierQty = quantities[i].getValue();
    if (qty >= tierQty) {
      selectedQuantity = quantities[i];
    }
  }
  return selectedQuantity;
}

/**
 * Calculate price based on quantity (handle tiered pricing)
 */
function calculateProductPrice(priceModel, qty) {
  var priceTable = priceModel.getPriceTable();
  if (hasTieredPricing(priceTable)) {
    var quantities = priceTable.getQuantities();
    var selectedQuantity = findQuantityTier(quantities, qty);
    return selectedQuantity ? priceTable.getPrice(selectedQuantity) : priceModel.getPrice();
  }
  return priceModel.getPrice();
}

/**
 * Get final unit price including promotions
 */
function getFinalUnitPrice(product, basePrice) {
  var promotionalPrice = priceHelper.getPromotionPrice(product, null, null);
  return promotionalPrice && promotionalPrice.available && promotionalPrice.value < basePrice.value ? promotionalPrice : basePrice;
}

/**
 * Handle price calculation response
 */
function sendPriceResponse(res, next, product, price, qty) {
  var unitPrice = getFinalUnitPrice(product, price);
  var totalAmount = unitPrice.multiply(qty);
  var minorUnitValue = AdyenHelper.getCurrencyValueForApi(totalAmount).value;
  res.json({
    success: true,
    totalAmount: {
      value: totalAmount.value,
      minorUnitValue,
      currencyCode: totalAmount.currencyCode
    }
  });
  return next();
}

/**
 * Handle error response
 */
function sendErrorResponse(res, next) {
  res.json({
    success: false,
    error: true
  });
  return next();
}

/**
 * Process price calculation for validated product
 */
function processPriceCalculation(product, qty, res, next) {
  var priceModel = product.getPriceModel();
  if (!priceModel) {
    AdyenLogs.error_log('Price model not available for product', product.ID || 'unknown');
    return sendErrorResponse(res, next);
  }
  var price = calculateProductPrice(priceModel, qty);
  if (!price) {
    AdyenLogs.error_log('Price not available for product', product.ID || 'unknown');
    return sendErrorResponse(res, next);
  }
  return sendPriceResponse(res, next, product, price, qty);
}

/**
 * Calculate product total price based on product ID
 */
function calculatePrice(req, res, next) {
  try {
    var {
      pid,
      quantity
    } = req.form;
    if (quantity === undefined) {
      quantity = 1;
    }
    var validation = validateProduct(pid);
    if (validation.error) {
      throw new AdyenError('Validation failed for product');
    }
    var product = getProductForPricing(validation.product);
    var qty = parseInt(quantity, 10) || 1;
    return processPriceCalculation(product, qty, res, next);
  } catch (error) {
    AdyenLogs.error_log('An error occurred while calculating the product price', error);
    setErrorType(error, res, {
      errorMessage: Resource.msg('error.cannot.get.product.price', 'product', null)
    });
    return sendErrorResponse(res, next);
  }
}
module.exports = calculatePrice;