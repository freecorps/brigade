# The app's side of the "I'm on call" widget: keeps the on-call snapshot in the App Group and asks WidgetKit to
# reload. The widget extension itself is a separate target (plugins/widget.ts, ../widget). Not named BrigadeWidget:
# that is the extension target's module, which the app's `import` would find instead.
Pod::Spec.new do |s|
  s.name           = 'BrigadeOnCallWidget'
  s.version        = '0.0.0'
  s.summary        = 'On-call snapshot for the Brigade widget'
  s.description    = 'Writes the signed-in member\'s on-call snapshot to the App Group and reloads the widget.'
  s.author         = 'Freecorps Tecnologia da Informação LTDA'
  s.homepage       = 'https://github.com/freecorps/brigade'
  s.license        = 'AGPL-3.0-only'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "*.swift"
end
