# Unofficial Adyen Salesforce Commerce Cloud Fork

> [!WARNING]
> **This repository is an unofficial fork of Adyen's Salesforce Commerce Cloud cartridge.**
>
> It is independently maintained and is not an official Adyen distribution. Code, generated cartridges, branches, and release artifacts in this repository may differ from the upstream Adyen cartridge.
>
> Adyen's official repository and documentation remain the source of truth for standard cartridge functionality, releases, support, and installation guidance.

## Purpose of This Fork

This fork provides a reviewable workflow for consuming Adyen's readable source together with the generated Salesforce Commerce Cloud-compatible output.

The primary goals are to:

- Keep the Adyen base implementation as close to upstream as possible.
- Maintain readable source alongside the generated SFCC-compatible cartridge output.
- Make upstream Adyen upgrades easier to review.
- Make changes introduced by transpilation visible in pull requests.
- Provide a repeatable version-based workflow for evaluating and adopting new Adyen releases.
- Allow downstream custom cartridges to be reviewed and updated in parallel with upstream changes.

Unlike the upstream repository, this fork intentionally commits the generated `./cartridges/` directory. Generated files are committed so the exact output produced by transpilation can be reviewed alongside the readable source rather than being treated as an opaque build artifact.

Do not modify generated files in `./cartridges/` as the source of a fix or customization. Source changes should be made under `./src/cartridges/` and regenerated through the normal transpilation process.

## Branch Workflow

The repository uses the following branch convention:

- `main` - Tracks changes pulled from Adyen's upstream `main` branch.
- `readable/main` - Default integration and review branch containing readable source together with committed generated cartridge output.
- `readable/[version]` - Version-specific upgrade and transpilation branch, for example `readable/26.4.0`.

## Updating from the Upstream Adyen Repository

1. **Update `main`.**

   Pull or merge the required changes from Adyen's upstream `main` branch into this fork's `main` branch.

2. **Update `readable/main`.**

   Bring the new upstream changes from `main` into `readable/main`.

3. **Create a version branch.**

   Create a version-specific branch from `readable/main`, for example `readable/26.4.0`.

4. **Transpile the cartridge.**

   From the version branch, run `pnpm run transpile`.

   This generates the SFCC-compatible cartridge output under `./cartridges/` from the readable source under `./src/cartridges/`.

5. **Commit the generated output.**

   Commit the resulting changes to `./cartridges/` on the `readable/[version]` branch.

6. **Open the upgrade pull request.**

   Open a pull request from `readable/[version]` into `readable/main`.

   For example: `readable/26.4.0` → `readable/main`.

7. **Review downstream customizations in parallel.**

   While reviewing the fork upgrade PR, downstream projects should update and review their custom Adyen cartridge against the same Adyen version.

   Review the two changesets together to identify:

   - Customizations that Adyen now provides upstream and can be removed.
   - Overrides that can be reduced to thin wrappers around the new base implementation.
   - Project-specific functionality that should remain isolated in a custom cartridge.
   - Copied upstream modules that can be replaced by `module.superModule`.
   - Behavioral changes introduced by the new Adyen version.
   - Differences introduced by transpilation into `./cartridges/`.

## Customization Strategy

When maintaining a downstream custom integration against this fork, prefer the following approaches in order:

1. Use the upstream Adyen implementation unchanged.
2. Use a small custom override with `module.superModule`.
3. Wrap the upstream implementation and add custom behavior before or after the base implementation.
4. Use a standalone custom helper when the functionality is additive rather than an override of Adyen behavior.
5. Use controller middleware, SFRA route extensions, or SFCC hooks when they provide a cleaner extension point than copying an Adyen module.
6. Use a full or near-copy override only when Adyen's private or module-scoped implementation prevents a safe extension.

The goal is to keep the difference between upstream Adyen and downstream customizations as small, explicit, and reviewable as possible.

## Important Notes

- Do not modify generated files in `./cartridges/` as the source of a fix or customization.
- Make source changes in `./src/cartridges/` or the appropriate downstream custom cartridge.
- Run `pnpm run transpile` to regenerate SFCC-compatible output.
- Commit the generated output so it can be reviewed against the corresponding readable source changes.
- Treat upstream Adyen behavior as authoritative unless a customization has a documented requirement.
- Re-evaluate existing customizations during each upgrade instead of automatically carrying them forward.
- Remove customizations when equivalent behavior has been incorporated upstream.
- This fork does not replace Adyen's official documentation, support channels, releases, or repository.

---
---

# Salesforce Commerce Cloud Adyen Cartridge

Adyen provides a LINK cartridge to integrate with [Salesforce Commerce Cloud (SFCC)](https://docs.adyen.com/plugins/salesforce-commerce-cloud). This cartridge enables an SFCC storefront to use the Adyen payment service.

## Documentation and Support

For general inquiries related to this repository, developers are welcome to leverage [![AskDeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Adyen/adyen-salesforce-commerce-cloud) AI knowledge base. Please note that while the DeepWiki can be a helpful resource, the **official [Adyen documentation](https://docs.adyen.com/plugins/salesforce-commerce-cloud/) remains the source of truth** for the cartridge. Information found in the DeepWiki should be used at your own discretion.

Navigate to [Adyen Docs](https://docs.adyen.com/plugins/salesforce-commerce-cloud/) to read about how to:
- [1. Install the cartridge](https://docs.adyen.com/plugins/salesforce-commerce-cloud/sfra/install-the-cartridge-and-import-the-metadata),
- [2. How to add Adyen Settings page (src/bm_adyen) into SFCC Business Manager](https://docs.adyen.com/plugins/salesforce-commerce-cloud/sfra/set-up-the-cartridge?plugin=Salesforce+SFRA&integration=cartridge#set-up-the-business-manager) for easy payments set-up,
- [3. Set-up Adyen Cartridge](https://docs.adyen.com/plugins/salesforce-commerce-cloud/sfra/set-up-the-cartridge?plugin=Salesforce+SFRA&integration=cartridge),
- [4. Configure Adyen Payments](https://docs.adyen.com/plugins/salesforce-commerce-cloud/sfra/set-up-payment-methods?plugin=Salesforce+SFRA&integration=cartridge),
- [5. How to Customise the cartridge, Front-end and Payment methods](https://docs.adyen.com/plugins/salesforce-commerce-cloud/sfra/customization-guide),
- [6. See a full list of Supported Payment Methods](https://docs.adyen.com/plugins/salesforce-commerce-cloud/supported-payment-methods/),
- [7. Upgrade your Adyen cartridge](https://docs.adyen.com/plugins/salesforce-commerce-cloud/sfra/upgrade),
- [8. Apple Pay configuration using Adyen certificate or own certificate via Salesforce Apple Pay cartridge](https://docs.adyen.com/plugins/salesforce-commerce-cloud/sfra/set-up-payment-methods?plugin=Salesforce+SFRA&integration=cartridge#set-up-apple-pay-on-the-web). We recommend using Apple pay with Adyen certificate as Adyen has no insight into Salesforce Apple Pay cartridge.

Adyen provides specialized cartridge support for 2 years for major versions, following the [SFCC B2C Support policy](https://docs.adyen.com/plugins/salesforce-commerce-cloud#support-levels), along with permanent Adyen support. Navigate to your Adyen Customer Area Merchant Account to raise a support case.
When a major cartridge version is no longer under cartridge support, it will be treated as a custom merchant integration.

### Customization Best Practices
**Best practice!**
- Modularizing customizations is the recommended approach, as [outlined by Salesforce](https://developer.salesforce.com/docs/commerce/sfra/guide/b2c-customizing-sfra.html).
- To customize Adyen payments, create a custom cartridge in your project directory or leverage `int_custom_cartridge`, which is already set up in our repository.
- For more guidance on customization, refer to [Adyen Customization Guide](https://docs.adyen.com/plugins/salesforce-commerce-cloud/customization-guide/#add-custom-code).

**Not Recommended**
- We strongly discourage adding changes directly to Adyen code in /src/cartridges.
- Customizations made in Adyen default code cannot be easily separated from your codebase once deployed to production, leading to a more complex and costly upgrade process and reduced Support.

## Compatibility with SFCC architectures
- SFRA version 5.x.x, 6.x.x. & 7.x.x.: [Supported in all cartridge versions, see the latest](https://github.com/Adyen/adyen-salesforce-commerce-cloud/releases)
- We have a [separate repository for Adyen SFCC PWA (Composable Storefront)](https://github.com/Adyen/adyen-salesforce-headless-commerce-pwa) payment integration.

## Integration
This cartridge allows you to integrate with Adyen without the need for any development work from your end.
- Online payments are processed on the back-end using the [Checkout API](https://docs.adyen.com/api-explorer/Checkout/latest/overview), and on the client side, Adyen’s [Web Components](https://docs.adyen.com/online-payments/components-web) are used to render payment methods.
- Point of Sale (POS) payments are processed using a cloud-based [Terminal API](https://docs.adyen.com/point-of-sale/terminal-api-fundamentals).

### Transpilation
Some files in the /src directory contain modern JavaScript (ES6) that Salesforce Commerce Cloud does not natively support.
If you want to make ES6 code compatible with ES5 by transpiling, compiling, and uploading the auto-generated code to the /cartridges directory, see [more in our Docs](https://docs.adyen.com/plugins/salesforce-commerce-cloud/install-the-cartridge-and-import-the-metadata/#step-3-build-the-code).


## Requirements

It is required to have an Adyen TEST and, later, LIVE account to use the cartridge. You can set it up [here](https://www.adyen.com/signup) or [contact Adyen](https://www.adyen.com/contact/sales).

## Testing
End-to-End tests can be found in the `adyen-salesforce-commerce-cloud/tests/e2e` directory.
They are run automatically via Github Actions using the `E2E.yml` workflow.
To run the tests locally use the following command:
```
`pnpm run test:e2e`
```
Note: Please make sure to fill in the environment variables in the `fixtures` directory before running the tests locally.

As for Unit tests, they are currently only available for SFRA. Test files can be found next to the files they are testing. Mocks are kept in the `jest` directory.
To run SFRA unit tests locally use the following command:
```
`pnpm run test`
```

## Contributing
We strongly encourage you to join us in contributing to this repository so everyone can benefit from:
* New features and functionality
* Resolved bug fixes and issues
* Any general improvements

Read our [**contribution guidelines**](CONTRIBUTING.md) to find out how.

## Platform

Read more information about the [Adyen platform](https://www.adyen.com/platform).

## Licence

MIT license see LICENSE.
