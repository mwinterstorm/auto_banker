# auto_banker

## Installation
1. set up personal account with Akahu (https://akahu.nz)
1. get app token and user token from developer page
1. Use following to find account ids
```bash
curl -s https://api.akahu.io/v1/accounts \
  -H "Authorization: Bearer {user_access_token}" \
  -H "X-Akahu-Id: {your_app_id}"
```
1. rename config_example.yaml to config.yaml and update details
1. install with HA???

