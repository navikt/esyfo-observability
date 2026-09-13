/** Strip package configuration and conventional token variables from the isolated install. */
export function consumerEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/(^p?npm_config_|token$)/iu.test(key)));
}
