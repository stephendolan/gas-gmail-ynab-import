function setProperties(properties) {
  PropertiesService.getUserProperties().setProperties(JSON.parse(properties), true);
}
