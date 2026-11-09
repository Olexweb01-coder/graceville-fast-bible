// import { Notification, app } from "electron"
import { autoUpdater } from "electron-updater"
import { isProd } from ".."

// let notification: Notification | null

export default async function checkForUpdates() {
    // Graceville: automatic background updates are off. Graceville installers are built and installed by hand,
    // and this updater would otherwise look for FreeShow's update files.
    const GRACEVILLE_AUTO_UPDATES = false
    if (!isProd || !GRACEVILLE_AUTO_UPDATES) return

    try {
        await autoUpdater.checkForUpdatesAndNotify()
    } catch (err) {
        console.error("Auto-update error:", err)
    }

    // {
    //   title: app.getName(),
    //   body: "Downloading new update...",
    // }

    // autoUpdater.logger = console;

    // autoUpdater.on("update-available", () => {
    //   notification = new Notification({
    //     title: app.getName(),
    //     body: "Updates are available. Click to download.",
    //     silent: true,
    //     icon: nativeImage.createFromPath(join(__dirname, "..", "..", "public", "icon.png")),
    //   })
    //   notification.show()
    //   notification.on("click", () => {
    //     autoUpdater.downloadUpdate().catch((err) => {
    //       console.error(JSON.stringify(err))
    //     })
    //   })
    // })

    // // autoUpdater.on("update-not-available", () => {
    // //   notification = new Notification({
    // //     title: app.getName(),
    // //     body: "Your software is up to date.",
    // //     silent: true,
    // //     icon: nativeImage.createFromPath(join(__dirname, "..", "..", "public", "icon.png"))
    // //   })
    // //   notification.show()
    // // })

    // autoUpdater.on("update-downloaded", () => {
    //   notification = new Notification({
    //     title: app.getName(),
    //     body: "The updates are ready. Click to quit and install.",
    //     silent: true,
    //     icon: nativeImage.createFromPath(join(__dirname, "..", "..", "public", "icon.png")),
    //   })
    //   notification.show()
    //   notification.on("click", () => {
    //     autoUpdater.quitAndInstall()
    //   })
    // })

    // autoUpdater.on("error", (err) => {
    //   notification = new Notification({
    //     title: app.getName(),
    //     body: "Error: " + JSON.stringify(err) + "\n" + autoUpdater.getFeedURL(),
    //     silent: true,
    //     // icon: nativeImage.createFromPath(join(__dirname, "..", "..", "public", "icon.png")),
    //   })

    //   notification.show()
    // })
}
