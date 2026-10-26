# The app's side of spike S1 (RFC 0006): the device key for encrypted pushes, and the Acknowledge action on pages
# (RFC 0004 "Clients"). The Notification Service Extension compiles BrigadePushCrypto.swift and BrigadePage.swift too
# (plugins/notification-service.ts copies them into its target).
Pod::Spec.new do |s|
  s.name           = 'BrigadePush'
  s.version        = '0.0.0'
  s.summary        = 'Device key for Brigade encrypted pushes'
  s.description    = 'Creates the P-256 key that encrypted pushes are sealed to and keeps it in the shared Keychain.'
  s.author         = 'Freecorps Tecnologia da Informação LTDA'
  s.homepage       = 'https://github.com/freecorps/brigade'
  s.license        = 'AGPL-3.0-only'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # PageActions joins its notification delegates to see the Acknowledge tap first.
  s.dependency 'ExpoNotifications'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "*.swift"
end
