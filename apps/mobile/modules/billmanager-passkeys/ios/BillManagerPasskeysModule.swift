import AuthenticationServices
import ExpoModulesCore
import UIKit

public final class BillManagerPasskeysModule: Module {
  private var activeController: ASAuthorizationController?
  private var activeDelegate: PasskeyAuthorizationDelegate?
  private var activePromise: Promise?

  public func definition() -> ModuleDefinition {
    Name("BillManagerPasskeys")

    AsyncFunction("isSupported") { () -> Bool in
      if #available(iOS 16.0, *) {
        return true
      }
      return false
    }

    AsyncFunction("createCredential") { (optionsJson: String, promise: Promise) in
      do {
        let options = try parseJSONObject(optionsJson)
        let challenge = try decodeBase64URL(requiredString(options, key: "challenge"))
        let relyingParty = try requiredDictionary(options, key: "rp")
        let relyingPartyID = try requiredString(relyingParty, key: "id")
        try ensureRelyingPartyEntitlement(relyingPartyID)
        let user = try requiredDictionary(options, key: "user")
        let userID = try decodeBase64URL(requiredString(user, key: "id"))
        let userName = try requiredString(user, key: "name")

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
          relyingPartyIdentifier: relyingPartyID
        )
        let request = provider.createCredentialRegistrationRequest(
          challenge: challenge,
          name: userName,
          userID: userID
        )
        request.displayName = user["displayName"] as? String ?? userName

        if let selection = options["authenticatorSelection"] as? [String: Any],
           let preference = selection["userVerification"] as? String {
          request.userVerificationPreference = userVerificationPreference(preference)
        }
        if let attestation = options["attestation"] as? String {
          request.attestationPreference = attestationPreference(attestation)
        }
        if #available(iOS 17.4, *),
           let excluded = options["excludeCredentials"] as? [[String: Any]] {
          request.excludedCredentials = try excluded.compactMap { descriptor in
            guard let credentialID = descriptor["id"] as? String else {
              return nil
            }
            return ASAuthorizationPlatformPublicKeyCredentialDescriptor(
              credentialID: try decodeBase64URL(credentialID)
            )
          }
        }

        try perform(request: request, promise: promise)
      } catch {
        promise.reject(error)
      }
    }
    .runOnQueue(.main)

    AsyncFunction("getCredential") { (optionsJson: String, promise: Promise) in
      do {
        let options = try parseJSONObject(optionsJson)
        let challenge = try decodeBase64URL(requiredString(options, key: "challenge"))
        let relyingPartyID = try requiredString(options, key: "rpId")
        try ensureRelyingPartyEntitlement(relyingPartyID)

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
          relyingPartyIdentifier: relyingPartyID
        )
        let request = provider.createCredentialAssertionRequest(challenge: challenge)

        if let preference = options["userVerification"] as? String {
          request.userVerificationPreference = userVerificationPreference(preference)
        }
        if let allowed = options["allowCredentials"] as? [[String: Any]] {
          request.allowedCredentials = try allowed.compactMap { descriptor in
            guard let credentialID = descriptor["id"] as? String else {
              return nil
            }
            return ASAuthorizationPlatformPublicKeyCredentialDescriptor(
              credentialID: try decodeBase64URL(credentialID)
            )
          }
        }

        try perform(request: request, promise: promise)
      } catch {
        promise.reject(error)
      }
    }
    .runOnQueue(.main)
  }

  private func perform(request: ASAuthorizationRequest, promise: Promise) throws {
    guard activePromise == nil else {
      throw PasskeyInProgressException()
    }
    guard let window = appContext?.utilities?.currentViewController()?.view.window else {
      throw PasskeyPresentationException()
    }

    let delegate = PasskeyAuthorizationDelegate(
      presentationWindow: window,
      onAuthorization: { [weak self] authorization in
        self?.handleAuthorization(authorization)
      },
      onError: { [weak self] error in
        self?.handleAuthorizationError(error)
      }
    )
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = delegate
    controller.presentationContextProvider = delegate
    activeController = controller
    activeDelegate = delegate
    activePromise = promise
    controller.performRequests()
  }

  private func handleAuthorization(_ authorization: ASAuthorization) {
    do {
      let response: [String: Any]
      if let registration = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
        guard let attestationObject = registration.rawAttestationObject else {
          throw InvalidPasskeyResponseException("AuthenticationServices did not return an attestation object.")
        }
        let credentialID = encodeBase64URL(registration.credentialID)
        response = [
          "id": credentialID,
          "rawId": credentialID,
          "type": "public-key",
          "response": [
            "clientDataJSON": encodeBase64URL(registration.rawClientDataJSON),
            "attestationObject": encodeBase64URL(attestationObject),
            "transports": ["internal"],
          ],
          "clientExtensionResults": [:],
        ]
      } else if let assertion = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
        let credentialID = encodeBase64URL(assertion.credentialID)
        let userHandle: Any
        if assertion.userID.isEmpty {
          userHandle = NSNull()
        } else {
          userHandle = encodeBase64URL(assertion.userID)
        }
        response = [
          "id": credentialID,
          "rawId": credentialID,
          "type": "public-key",
          "response": [
            "clientDataJSON": encodeBase64URL(assertion.rawClientDataJSON),
            "authenticatorData": encodeBase64URL(assertion.rawAuthenticatorData),
            "signature": encodeBase64URL(assertion.signature),
            "userHandle": userHandle,
          ],
          "clientExtensionResults": [:],
        ]
      } else {
        throw InvalidPasskeyResponseException("AuthenticationServices returned an unexpected credential type.")
      }

      let data = try JSONSerialization.data(withJSONObject: response)
      guard let json = String(data: data, encoding: .utf8) else {
        throw InvalidPasskeyResponseException("The passkey response could not be encoded.")
      }
      activePromise?.resolve(json)
    } catch {
      activePromise?.reject(error)
    }
    clearActiveRequest()
  }

  private func handleAuthorizationError(_ error: Error) {
    if let authorizationError = error as? ASAuthorizationError,
       authorizationError.code == .canceled {
      activePromise?.reject(PasskeyCancelledException())
    } else {
      activePromise?.reject(PasskeyOperationException(error.localizedDescription).causedBy(error))
    }
    clearActiveRequest()
  }

  private func clearActiveRequest() {
    activeController = nil
    activeDelegate = nil
    activePromise = nil
  }
}

private final class PasskeyAuthorizationDelegate: NSObject,
  ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding {
  private let presentationWindow: ASPresentationAnchor
  private let onAuthorization: (ASAuthorization) -> Void
  private let onError: (Error) -> Void

  init(
    presentationWindow: ASPresentationAnchor,
    onAuthorization: @escaping (ASAuthorization) -> Void,
    onError: @escaping (Error) -> Void
  ) {
    self.presentationWindow = presentationWindow
    self.onAuthorization = onAuthorization
    self.onError = onError
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    presentationWindow
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    onAuthorization(authorization)
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithError error: Error
  ) {
    onError(error)
  }
}

private func parseJSONObject(_ json: String) throws -> [String: Any] {
  guard let data = json.data(using: .utf8),
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
    throw InvalidPasskeyOptionsException("Passkey options must be a JSON object.")
  }
  return object
}

private func requiredDictionary(_ object: [String: Any], key: String) throws -> [String: Any] {
  guard let value = object[key] as? [String: Any] else {
    throw InvalidPasskeyOptionsException("Passkey options are missing \(key).")
  }
  return value
}

private func requiredString(_ object: [String: Any], key: String) throws -> String {
  guard let value = object[key] as? String, !value.isEmpty else {
    throw InvalidPasskeyOptionsException("Passkey options are missing \(key).")
  }
  return value
}

private func ensureRelyingPartyEntitlement(_ relyingPartyID: String) throws {
  let configured = Bundle.main.object(forInfoDictionaryKey: "BillManagerPasskeyRPDomains") as? [String]
    ?? ["app.billmanager.app"]
  guard configured.contains(relyingPartyID.lowercased()) else {
    throw PasskeyUnavailableException(
      "This iOS build is not signed for passkeys on \(relyingPartyID). Add the domain to BILLMANAGER_IOS_PASSKEY_DOMAINS and rebuild the app."
    )
  }
}

private func decodeBase64URL(_ value: String) throws -> Data {
  var base64 = value.replacingOccurrences(of: "-", with: "+")
    .replacingOccurrences(of: "_", with: "/")
  let remainder = base64.count % 4
  if remainder != 0 {
    base64.append(String(repeating: "=", count: 4 - remainder))
  }
  guard let data = Data(base64Encoded: base64) else {
    throw InvalidPasskeyOptionsException("Passkey options contain invalid base64url data.")
  }
  return data
}

private func encodeBase64URL(_ data: Data) -> String {
  data.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

private func userVerificationPreference(
  _ value: String
) -> ASAuthorizationPublicKeyCredentialUserVerificationPreference {
  switch value {
  case "required":
    return .required
  case "discouraged":
    return .discouraged
  default:
    return .preferred
  }
}

private func attestationPreference(
  _ value: String
) -> ASAuthorizationPublicKeyCredentialAttestationKind {
  switch value {
  case "direct":
    return .direct
  case "indirect":
    return .indirect
  case "enterprise":
    return .enterprise
  default:
    return .none
  }
}

private final class PasskeyInProgressException: Exception {
  override var reason: String { "A passkey request is already in progress." }
}

private final class PasskeyPresentationException: Exception {
  override var reason: String { "BillManager could not present the passkey sheet." }
}

private final class PasskeyUnavailableException: GenericException<String> {
  override var reason: String { param }
}

private final class PasskeyCancelledException: Exception {
  override var reason: String { "The passkey request was cancelled." }
}

private final class PasskeyOperationException: GenericException<String> {
  override var reason: String { param }
}

private final class InvalidPasskeyOptionsException: GenericException<String> {
  override var reason: String { param }
}

private final class InvalidPasskeyResponseException: GenericException<String> {
  override var reason: String { param }
}
