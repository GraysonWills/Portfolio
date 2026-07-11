import Capacitor
import LocalAuthentication
import Security

@objc(SecureSessionPlugin)
public final class SecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureSessionPlugin"
    public let jsName = "SecureSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlockCredential", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCredential", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.graysonwills.authorstudio.secure-session"
    private let account = "cognito-refresh"

    @objc public func availability(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        let biometry: String

        if #available(iOS 11.0, *) {
            switch context.biometryType {
            case .faceID:
                biometry = "faceID"
            case .touchID:
                biometry = "touchID"
            case .opticID:
                biometry = "opticID"
            default:
                biometry = "none"
            }
        } else {
            biometry = "none"
        }

        call.resolve([
            "available": available,
            "biometry": biometry
        ])
    }

    @objc public func saveCredential(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), !value.isEmpty,
              let data = value.data(using: .utf8) else {
            call.reject("A non-empty credential is required.", "INVALID_CREDENTIAL")
            return
        }

        var accessError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            .biometryCurrentSet,
            &accessError
        ) else {
            let error = accessError?.takeRetainedValue()
            call.reject(error?.localizedDescription ?? "Unable to configure biometric Keychain access.", "ACCESS_CONTROL_FAILED")
            return
        }

        SecItemDelete(baseQuery() as CFDictionary)
        var query = baseQuery()
        query[kSecValueData as String] = data
        query[kSecAttrAccessControl as String] = accessControl
        query[kSecUseDataProtectionKeychain as String] = true

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            call.reject(keychainMessage(status), "KEYCHAIN_SAVE_FAILED")
            return
        }

        call.resolve()
    }

    @objc public func unlockCredential(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Unlock Author Studio"
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"

        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context
        query[kSecUseOperationPrompt as String] = reason
        query[kSecUseDataProtectionKeychain as String] = true

        DispatchQueue.global(qos: .userInitiated).async {
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)

            DispatchQueue.main.async {
                if status == errSecItemNotFound {
                    call.resolve(["value": NSNull()])
                    return
                }
                guard status == errSecSuccess,
                      let data = result as? Data,
                      let value = String(data: data, encoding: .utf8) else {
                    call.reject(self.keychainMessage(status), "KEYCHAIN_UNLOCK_FAILED")
                    return
                }
                call.resolve(["value": value])
            }
        }
    }

    @objc public func clearCredential(_ call: CAPPluginCall) {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject(keychainMessage(status), "KEYCHAIN_CLEAR_FAILED")
            return
        }
        call.resolve()
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false
        ]
    }

    private func keychainMessage(_ status: OSStatus) -> String {
        (SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)."
    }
}
