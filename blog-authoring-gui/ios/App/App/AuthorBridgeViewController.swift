import Capacitor

final class AuthorBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SecureSessionPlugin())
    }
}
