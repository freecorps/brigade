# The iOS side of the call screen (spike S6, RFC 0010): PushKit VoIP pushes reported to CallKit, the call's audio
# session and text-to-speech. Decrypts with BrigadePushCrypto from the BrigadePush pod.
Pod::Spec.new do |s|
  s.name           = 'BrigadeCall'
  s.version        = '0.0.0'
  s.summary        = 'Brigade pages as native calls'
  s.description    = 'Reports VoIP pushes to CallKit, reads the incident aloud and takes the keypad ack.'
  s.author         = 'Freecorps Tecnologia da Informação LTDA'
  s.homepage       = 'https://github.com/freecorps/brigade'
  s.license        = 'AGPL-3.0-only'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'BrigadePush'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "*.swift"
end
