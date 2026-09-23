'use strict';

// Иконка и сведения о версии для LifeVPN.exe.
//
// Обычно это делает rcedit, но вне Windows он требует Wine. resedit — то же
// самое на чистом JavaScript, поэтому сборка работает где угодно.

const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = require('resedit');
  const { productFilename } = context.packager.appInfo;
  const exeName = `${context.packager.platformSpecificBuildOptions.executableName || context.packager.config.executableName || productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const version = context.packager.appInfo.version;

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icons', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupID = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupID, lang, iconFile.icons.map((i) => i.data));

  const infos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const info = infos.length ? infos[0] : ResEdit.Resource.VersionInfo.createEmpty();
  const [major, minor, patch] = version.split('.').map((v) => parseInt(v, 10) || 0);
  info.setFileVersion(major, minor, patch, 0, 1033);
  info.setProductVersion(major, minor, patch, 0, 1033);
  const strings = {
    FileDescription: 'Life VPN',
    ProductName: 'Life VPN',
    CompanyName: 'stailegrow',
    LegalCopyright: '© stailegrow',
    OriginalFilename: exeName,
    InternalName: 'LifeVPN',
    FileVersion: version,
    ProductVersion: version
  };
  for (const lng of info.getAllLanguagesForStringValues()) {
    info.setStringValues(lng, strings);
  }
  if (!info.getAllLanguagesForStringValues().length) info.setStringValues({ lang: 1033, codepage: 1200 }, strings);
  info.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • иконка и версия записаны в ${exeName}`);
};
