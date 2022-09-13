# Todo For Next Update

When you overtake this deploy and rebrand repo to your network you have to recognize the following changes and doings …

## Version 1.0.9 with 'ocelotDockerVersionTag' 1.0.9-199

### Deployment/Rebranding PR – chore: [WIP] 🍰 Refine docs, first step #46

- PR: `chore: 🍰 Implement PRODUCTION_DB_CLEAN_ALLOW for Staging Production Environments #56`
  - Copy `PRODUCTION_DB_CLEAN_ALLOW` from `values.template.yaml` to `values.yaml` and set it to `false` for production envireonments and only for several stage test servers to `true`.
- Commit: `Update cert-manager apiVersion "cert-manager.io/v1alpha2" to "cert-manager.io/v1"
  - Check for `kubectl` and `helm` versions.

## Version 1.0.8 with 'ocelotDockerVersionTag' 1.0.8-182

### PR – feat: 🍰 Configure Cookie Expire Time #43

- You have to add the `COOKIE_EXPIRE_TIME` from the `deployment/kubernetes/values.template.yaml` to your `deployment/kubernetes/values.yaml` and set it to your prevered value.
- Correct `locale` cookie exploration time in data privacy.

## Version 1.0.7 with 'ocelotDockerVersionTag' 1.0.7-171

- No informations.
