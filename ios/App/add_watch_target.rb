# Adds the WatchApp (watchOS companion) target to App.xcodeproj.
# Run once: ruby add_watch_target.rb  (idempotent — bails if target exists)
require 'xcodeproj'

project = Xcodeproj::Project.open('App.xcodeproj')
if project.targets.any? { |t| t.name == 'WatchApp' }
  puts 'WatchApp target already exists — nothing to do'
  exit 0
end

app_target = project.targets.find { |t| t.name == 'App' } or abort 'No App target'

watch = project.new_target(:application, 'WatchApp', :watchos, '11.0')

group = project.main_group.new_group('WatchApp', 'WatchApp')
sources = %w[WatchApp.swift Models.swift API.swift SessionStore.swift WorkoutManager.swift Views.swift StartTrainingIntent.swift]
source_refs = sources.map { |f| group.new_reference(f) }
assets_ref = group.new_reference('Assets.xcassets')
group.new_reference('Info.plist')
group.new_reference('WatchApp.entitlements')

source_refs.each { |ref| watch.add_file_references([ref]) }
watch.resources_build_phase.add_file_reference(assets_ref)

watch.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.aralhamoud.workout.watchkitapp'
  s['INFOPLIST_FILE'] = 'WatchApp/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = 'WatchApp/WatchApp.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['DEVELOPMENT_TEAM'] = '263G7A2Q2N'
  s['SDKROOT'] = 'watchos'
  s['WATCHOS_DEPLOYMENT_TARGET'] = '11.0'
  s['TARGETED_DEVICE_FAMILY'] = '4'
  s['SWIFT_VERSION'] = '5.0'
  s['MARKETING_VERSION'] = '1.0'
  s['CURRENT_PROJECT_VERSION'] = '2'
  s['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
  s['WATCH_BASE_URL'] = 'https://workout-app-gamma-rouge.vercel.app'
  s['SWIFT_EMIT_LOC_STRINGS'] = 'YES'
  s['ENABLE_PREVIEWS'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks']
end

# Embed into the iOS app: dependency + "Embed Watch Content" copy phase.
app_target.add_dependency(watch)
embed = app_target.new_copy_files_build_phase('Embed Watch Content')
embed.dst_subfolder_spec = Xcodeproj::Constants::COPY_FILES_BUILD_PHASE_DESTINATIONS[:products_directory]
embed.dst_path = '$(CONTENTS_FOLDER_PATH)/Watch'
build_file = embed.add_file_reference(watch.product_reference)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts "WatchApp target added: #{sources.length} sources, embed phase wired"
