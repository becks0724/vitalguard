import Foundation
import PhotosUI
import Security
import UIKit
import UniformTypeIdentifiers

private struct ChatMessage: Codable {
    let role: String
    let content: String
}

private enum AssistantAttachmentKind: String {
    case photo
    case video
    case file

    var symbol: String {
        switch self {
        case .photo: return "photo.fill"
        case .video: return "video.fill"
        case .file: return "doc.fill"
        }
    }

    var title: String {
        switch self {
        case .photo: return "사진"
        case .video: return "동영상"
        case .file: return "파일"
        }
    }
}

private struct AssistantAttachment: Identifiable {
    let id = UUID()
    let kind: AssistantAttachmentKind
    let displayName: String
}

private enum AssistantProvider: Int, CaseIterable {
    case openAI
    case hyperCLOVA

    var title: String {
        switch self {
        case .openAI: return "OpenAI"
        case .hyperCLOVA: return "HyperCLOVA"
        }
    }

    var keychainAccount: String {
        switch self {
        case .openAI: return "openai-api-key"
        case .hyperCLOVA: return "hyperclova-api-key"
        }
    }

    var keyPlaceholder: String {
        "\(title) API 키 입력"
    }
}

private enum VitAlGuardAssistantKeychain {
    static let service = "com.yangjeehoo.vitalguard.assistant"

    private static func accountQuery(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    static func save(_ value: String, for provider: AssistantProvider) throws {
        let data = Data(value.utf8)
        var keyQuery = accountQuery(provider.keychainAccount)
        SecItemDelete(keyQuery as CFDictionary)
        keyQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        keyQuery[kSecAttrSynchronizable as String] = kCFBooleanFalse
        keyQuery[kSecValueData as String] = data

        let status = SecItemAdd(keyQuery as CFDictionary, nil)
        if status != errSecSuccess {
            throw AssistantError.keychainSaveFailed(status)
        }
    }

    static func load(_ provider: AssistantProvider) -> String? {
        queryKey(accountQuery(provider.keychainAccount))
    }

    private static func queryKey(_ query: [String: Any]) -> String? {
        var keyQuery: [String: Any] = query
        keyQuery[kSecReturnData as String] = true
        keyQuery[kSecMatchLimit as String] = kSecMatchLimitOne
        keyQuery[kSecReturnAttributes as String] = false
        keyQuery[kSecAttrSynchronizable as String] = kSecAttrSynchronizableAny

        var raw: CFTypeRef?
        let status = SecItemCopyMatching(keyQuery as CFDictionary, &raw)
        guard status == errSecSuccess else {
            if status == errSecItemNotFound { return nil }
            return nil
        }
        guard let data = raw as? Data, let value = String(data: data, encoding: .utf8) else { return nil }
        return value
    }

    static func remove(_ provider: AssistantProvider) throws {
        let keyQuery = accountQuery(provider.keychainAccount)
        let status = SecItemDelete(keyQuery as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw AssistantError.keychainDeleteFailed(status)
        }
    }
}

final class VitAlGuardAssistantViewController: UIViewController, UITextViewDelegate, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
    var onCloseRequest: (() -> Void)?

    private let usageBar = UIView()
    private let usageLabel = UILabel()
    private let usageTokenLabel = UILabel()
    private let keyField = UITextField()
    private let providerControl = UISegmentedControl(items: ["OpenAI", "HyperCLOVA"])
    private let statusLabel = UILabel()
    private let systemInfoLabel = UILabel()
    private let messagesStack = UIStackView()
    private weak var rootScrollView: UIScrollView?
    private let inputField = UITextView()
    private let sendButton = UIButton(type: .system)
    private let attachmentButton = UIButton(type: .system)
    private let attachmentTray = UIView()
    private let attachmentScrollView = UIScrollView()
    private let attachmentStack = UIStackView()
    private let messageEditButton = UIButton(type: .system)
    private let messageEditToolbar = UIStackView()
    private let selectAllMessagesButton = UIButton(type: .system)
    private let deleteSelectedMessagesButton = UIButton(type: .system)
    private let finishMessageEditButton = UIButton(type: .system)
    private let saveButton = UIButton(type: .system)
    private let clearButton = UIButton(type: .system)
    private let deleteButton = UIButton(type: .system)
    private let refreshButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private let apiKeyButton = UIButton(type: .system)
    private let keySettingsCard = UIView()
    private var keySettingsHeightConstraint: NSLayoutConstraint?
    private var attachmentTrayHeightConstraint: NSLayoutConstraint?
    private var messageEditToolbarHeightConstraint: NSLayoutConstraint?
    private let keySettingsExpandedHeight: CGFloat = 184

    private var messages: [ChatMessage] = []
    private var requestCount = 0
    private var totalPromptTokens = 0
    private var totalCompletionTokens = 0
    private var totalTokens = 0
    private let messageInputContainer = UIView()
    private var pendingAttachments: [AssistantAttachment] = []
    private var isMessageEditMode = false
    private var selectedMessageIndexes = Set<Int>()
    private var activeProvider: AssistantProvider {
        providerControl.selectedSegmentIndex == AssistantProvider.openAI.rawValue ? .openAI : .hyperCLOVA
    }
    private let systemPrompt = """
    당신은 VitAlGuard 앱의 안전 보조 챗봇입니다.
    역할: 낙상 대응, 응급 상황, 건강/안전 질문에 대해 침착하고 간결한 가이드 제공.
    의료 진단·처방·법적 판단은 하지 마세요.
    위험 신호가 의심되면 즉시 119 또는 지역 응급 구조에 연락하라고 안내하세요.
    질문에 대해 1~3문단 이하로 짧게 설명하고, 과장된 확신은 피하세요.
    """

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.systemBackground
        title = "VitAlGuard 챗봇"
        navigationItem.title = ""

        configureUI()
        loadSavedState()
        seedMessagesIfNeeded()
    }

    private func configureUI() {
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .onDrag
        view.addSubview(scroll)
        rootScrollView = scroll

        setupUsageBar()
        view.addSubview(usageBar)

        setupKeySettingsCard()
        view.addSubview(keySettingsCard)

        keyField.borderStyle = .roundedRect
        keyField.isSecureTextEntry = true
        keyField.textContentType = .password
        keyField.autocapitalizationType = .none
        keyField.autocorrectionType = .no
        keyField.clearButtonMode = .whileEditing

        saveButton.setTitle("저장", for: .normal)
        saveButton.addTarget(self, action: #selector(saveKeyTapped), for: .touchUpInside)
        saveButton.layer.cornerRadius = 10
        saveButton.backgroundColor = UIColor.systemBlue
        saveButton.setTitleColor(.white, for: .normal)
        saveButton.contentEdgeInsets = UIEdgeInsets(top: 11, left: 14, bottom: 11, right: 14)

        deleteButton.setImage(UIImage(systemName: "trash"), for: .normal)
        deleteButton.addTarget(self, action: #selector(deleteKeyTapped), for: .touchUpInside)
        deleteButton.layer.cornerRadius = 10
        deleteButton.backgroundColor = UIColor.systemRed
        deleteButton.setTitleColor(.white, for: .normal)
        deleteButton.contentEdgeInsets = UIEdgeInsets(top: 11, left: 14, bottom: 11, right: 14)

        refreshButton.setImage(UIImage(systemName: "arrow.clockwise"), for: .normal)
        refreshButton.tintColor = .systemGray
        refreshButton.addTarget(self, action: #selector(refreshConversationTapped), for: .touchUpInside)
        refreshButton.translatesAutoresizingMaskIntoConstraints = false
        refreshButton.setContentHuggingPriority(.required, for: .horizontal)
        refreshButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        apiKeyButton.setImage(UIImage(systemName: "key.fill"), for: .normal)
        apiKeyButton.tintColor = .systemBlue
        apiKeyButton.addTarget(self, action: #selector(focusAPIKeyTapped), for: .touchUpInside)
        apiKeyButton.translatesAutoresizingMaskIntoConstraints = false
        apiKeyButton.setContentHuggingPriority(.required, for: .horizontal)
        apiKeyButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        messageEditButton.setImage(UIImage(systemName: "checklist"), for: .normal)
        messageEditButton.tintColor = .systemBlue
        messageEditButton.accessibilityLabel = "채팅 내역 선택 및 삭제"
        messageEditButton.addTarget(self, action: #selector(messageEditTapped), for: .touchUpInside)
        messageEditButton.translatesAutoresizingMaskIntoConstraints = false
        messageEditButton.setContentHuggingPriority(.required, for: .horizontal)
        messageEditButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        closeButton.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        closeButton.tintColor = .label
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.setContentHuggingPriority(.required, for: .horizontal)
        closeButton.widthAnchor.constraint(equalToConstant: 36).isActive = true

        statusLabel.textColor = .secondaryLabel
        statusLabel.font = .systemFont(ofSize: 12)
        statusLabel.numberOfLines = 2
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.text = "저장된 키가 없습니다."

        systemInfoLabel.text = "API 키는 이 기기의 Keychain에만 저장됩니다. 한 제공자 키만 있어도 대화를 시작할 수 있습니다."
        systemInfoLabel.textColor = .secondaryLabel
        systemInfoLabel.numberOfLines = 2
        systemInfoLabel.lineBreakMode = .byWordWrapping
        systemInfoLabel.font = .systemFont(ofSize: 12)

        let keyRow = UIStackView(arrangedSubviews: [keyField, saveButton, deleteButton])
        keyRow.spacing = 8
        keyRow.translatesAutoresizingMaskIntoConstraints = false

        messagesStack.axis = .vertical
        messagesStack.spacing = 8
        messagesStack.translatesAutoresizingMaskIntoConstraints = false

        inputField.backgroundColor = UIColor.systemBackground
        inputField.font = .systemFont(ofSize: 17)
        inputField.textColor = .placeholderText
        inputField.text = "메시지"
        inputField.accessibilityLabel = "메시지 입력"
        inputField.delegate = self
        inputField.layer.cornerRadius = 21
        inputField.layer.masksToBounds = true
        inputField.layer.borderWidth = 1 / UIScreen.main.scale
        inputField.layer.borderColor = UIColor.separator.withAlphaComponent(0.45).cgColor
        inputField.textContainerInset = UIEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
        inputField.isScrollEnabled = false
        inputField.translatesAutoresizingMaskIntoConstraints = false
        attachmentButton.setImage(UIImage(systemName: "plus.circle.fill"), for: .normal)
        attachmentButton.tintColor = .systemBlue
        attachmentButton.accessibilityLabel = "사진, 동영상 또는 파일 첨부"
        attachmentButton.translatesAutoresizingMaskIntoConstraints = false
        attachmentButton.addTarget(self, action: #selector(attachmentTapped), for: .touchUpInside)
        sendButton.setImage(UIImage(systemName: "arrow.up"), for: .normal)
        sendButton.accessibilityLabel = "메시지 전송"
        sendButton.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
        sendButton.translatesAutoresizingMaskIntoConstraints = false
        sendButton.tintColor = .white
        sendButton.layer.cornerRadius = 20
        sendButton.backgroundColor = UIColor.systemBlue
        sendButton.setTitleColor(.white, for: .normal)
        sendButton.contentEdgeInsets = UIEdgeInsets(top: 11, left: 16, bottom: 11, right: 16)

        clearButton.setTitle("채팅 초기화", for: .normal)
        clearButton.addTarget(self, action: #selector(clearTapped), for: .touchUpInside)
        clearButton.layer.cornerRadius = 10
        clearButton.backgroundColor = UIColor.systemGray
        clearButton.setTitleColor(.white, for: .normal)
        clearButton.contentEdgeInsets = UIEdgeInsets(top: 11, left: 14, bottom: 11, right: 14)

        messageInputContainer.translatesAutoresizingMaskIntoConstraints = false
        messageInputContainer.backgroundColor = UIColor.secondarySystemBackground
        messageInputContainer.layer.cornerRadius = 0
        messageInputContainer.layer.borderWidth = 1 / UIScreen.main.scale
        messageInputContainer.layer.borderColor = UIColor.separator.withAlphaComponent(0.55).cgColor
        view.addSubview(messageInputContainer)
        messageInputContainer.addSubview(attachmentButton)
        messageInputContainer.addSubview(inputField)
        messageInputContainer.addSubview(sendButton)

        NSLayoutConstraint.activate([
            attachmentButton.leadingAnchor.constraint(equalTo: messageInputContainer.leadingAnchor, constant: 12),
            attachmentButton.centerYAnchor.constraint(equalTo: messageInputContainer.centerYAnchor),
            attachmentButton.widthAnchor.constraint(equalToConstant: 32),
            attachmentButton.heightAnchor.constraint(equalToConstant: 32),
            inputField.leadingAnchor.constraint(equalTo: attachmentButton.trailingAnchor, constant: 8),
            inputField.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -8),
            inputField.topAnchor.constraint(equalTo: messageInputContainer.topAnchor, constant: 12),
            inputField.bottomAnchor.constraint(equalTo: messageInputContainer.bottomAnchor, constant: -12),
            sendButton.trailingAnchor.constraint(equalTo: messageInputContainer.trailingAnchor, constant: -16),
            sendButton.centerYAnchor.constraint(equalTo: messageInputContainer.centerYAnchor),
            sendButton.widthAnchor.constraint(equalToConstant: 40),
            sendButton.heightAnchor.constraint(equalToConstant: 40)
        ])

        let keyContent = UIStackView(arrangedSubviews: [providerControl, keyRow, statusLabel, systemInfoLabel])
        keyContent.axis = .vertical
        keyContent.spacing = 8
        keyContent.translatesAutoresizingMaskIntoConstraints = false
        keySettingsCard.addSubview(keyContent)

        scroll.addSubview(messagesStack)

        attachmentTray.translatesAutoresizingMaskIntoConstraints = false
        attachmentTray.backgroundColor = UIColor.secondarySystemBackground
        attachmentTray.isHidden = true
        view.addSubview(attachmentTray)

        attachmentScrollView.translatesAutoresizingMaskIntoConstraints = false
        attachmentScrollView.showsHorizontalScrollIndicator = false
        attachmentTray.addSubview(attachmentScrollView)

        attachmentStack.translatesAutoresizingMaskIntoConstraints = false
        attachmentStack.axis = .horizontal
        attachmentStack.spacing = 8
        attachmentStack.alignment = .center
        attachmentScrollView.addSubview(attachmentStack)

        configureMessageEditToolbar()
        view.addSubview(messageEditToolbar)

        NSLayoutConstraint.activate([
            keyField.heightAnchor.constraint(equalToConstant: 42),
            saveButton.widthAnchor.constraint(equalToConstant: 62),
            deleteButton.widthAnchor.constraint(equalToConstant: 42),
            deleteButton.heightAnchor.constraint(equalTo: keyField.heightAnchor),
            inputField.heightAnchor.constraint(greaterThanOrEqualToConstant: 42),
            inputField.heightAnchor.constraint(lessThanOrEqualToConstant: 100),
            messagesStack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -28)
        ])

        NSLayoutConstraint.activate([
            usageBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            usageBar.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            usageBar.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            keySettingsCard.topAnchor.constraint(equalTo: usageBar.bottomAnchor, constant: 8),
            keySettingsCard.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            keySettingsCard.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: keySettingsCard.bottomAnchor, constant: 4),
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: messageEditToolbar.topAnchor),
            messagesStack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 12),
            messagesStack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 14),
            messagesStack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -14),
            messagesStack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -12),
            attachmentTray.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            attachmentTray.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            messageEditToolbar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            messageEditToolbar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            messageEditToolbar.bottomAnchor.constraint(equalTo: attachmentTray.topAnchor),
            attachmentTray.bottomAnchor.constraint(equalTo: messageInputContainer.topAnchor),
            attachmentScrollView.topAnchor.constraint(equalTo: attachmentTray.topAnchor, constant: 6),
            attachmentScrollView.leadingAnchor.constraint(equalTo: attachmentTray.leadingAnchor, constant: 12),
            attachmentScrollView.trailingAnchor.constraint(equalTo: attachmentTray.trailingAnchor, constant: -12),
            attachmentScrollView.bottomAnchor.constraint(equalTo: attachmentTray.bottomAnchor, constant: -6),
            attachmentStack.topAnchor.constraint(equalTo: attachmentScrollView.contentLayoutGuide.topAnchor),
            attachmentStack.leadingAnchor.constraint(equalTo: attachmentScrollView.contentLayoutGuide.leadingAnchor),
            attachmentStack.trailingAnchor.constraint(equalTo: attachmentScrollView.contentLayoutGuide.trailingAnchor),
            attachmentStack.bottomAnchor.constraint(equalTo: attachmentScrollView.contentLayoutGuide.bottomAnchor),
            attachmentStack.heightAnchor.constraint(equalTo: attachmentScrollView.frameLayoutGuide.heightAnchor),
            messageInputContainer.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            messageInputContainer.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            messageInputContainer.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            messageInputContainer.heightAnchor.constraint(equalToConstant: 66)
        ])

        attachmentTrayHeightConstraint = attachmentTray.heightAnchor.constraint(equalToConstant: 0)
        attachmentTrayHeightConstraint?.isActive = true
        messageEditToolbarHeightConstraint = messageEditToolbar.heightAnchor.constraint(equalToConstant: 0)
        messageEditToolbarHeightConstraint?.isActive = true

        view.bringSubviewToFront(attachmentTray)
        view.bringSubviewToFront(messageInputContainer)

        keySettingsHeightConstraint = keySettingsCard.heightAnchor.constraint(equalToConstant: keySettingsExpandedHeight)
        keySettingsHeightConstraint?.isActive = true
        NSLayoutConstraint.activate([
            keyContent.topAnchor.constraint(equalTo: keySettingsCard.topAnchor, constant: 12),
            keyContent.leadingAnchor.constraint(equalTo: keySettingsCard.leadingAnchor, constant: 12),
            keyContent.trailingAnchor.constraint(equalTo: keySettingsCard.trailingAnchor, constant: -12),
            keyContent.bottomAnchor.constraint(equalTo: keySettingsCard.bottomAnchor, constant: -12)
        ])
    }

    private func setupKeySettingsCard() {
        keySettingsCard.translatesAutoresizingMaskIntoConstraints = false
        keySettingsCard.backgroundColor = UIColor.secondarySystemBackground
        keySettingsCard.layer.cornerRadius = 18
        keySettingsCard.layer.borderWidth = 1
        keySettingsCard.layer.borderColor = UIColor.separator.withAlphaComponent(0.4).cgColor

        providerControl.selectedSegmentIndex = AssistantProvider.hyperCLOVA.rawValue
        providerControl.addTarget(self, action: #selector(providerChanged), for: .valueChanged)
        providerControl.selectedSegmentTintColor = .systemBlue
        providerControl.setTitleTextAttributes([.foregroundColor: UIColor.white], for: .selected)
        updateProviderField()
    }

    private func setupUsageBar() {
        usageBar.translatesAutoresizingMaskIntoConstraints = false
        usageBar.layer.cornerRadius = 14
        usageBar.backgroundColor = UIColor.secondarySystemBackground
        usageBar.layer.borderWidth = 1
        usageBar.layer.borderColor = UIColor.separator.withAlphaComponent(0.35).cgColor
        usageBar.layer.shadowColor = UIColor.black.withAlphaComponent(0.08).cgColor
        usageBar.layer.shadowOpacity = 0.12
        usageBar.layer.shadowRadius = 8
        usageBar.layer.shadowOffset = CGSize(width: 0, height: 1)

        let topControlRow = UIStackView()
        topControlRow.translatesAutoresizingMaskIntoConstraints = false
        topControlRow.axis = .horizontal
        topControlRow.alignment = .center
        topControlRow.spacing = 8
        topControlRow.distribution = .fill

        let actionRow = UIStackView()
        actionRow.translatesAutoresizingMaskIntoConstraints = false
        actionRow.axis = .horizontal
        actionRow.alignment = .center
        actionRow.spacing = 8
        actionRow.distribution = .equalSpacing

        usageLabel.text = "HyperCLOVA · 요청 0건"
        usageLabel.font = .systemFont(ofSize: 13, weight: .medium)
        usageLabel.textColor = .secondaryLabel
        usageLabel.numberOfLines = 1
        usageLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        usageLabel.adjustsFontForContentSizeCategory = true

        usageTokenLabel.text = ""
        usageTokenLabel.font = .systemFont(ofSize: 11, weight: .regular)
        usageTokenLabel.textColor = .tertiaryLabel
        usageTokenLabel.numberOfLines = 1
        usageTokenLabel.adjustsFontForContentSizeCategory = true

        let titleLabel = UILabel()
        titleLabel.text = "VitAlGuard 챗봇"
        titleLabel.font = .systemFont(ofSize: 17, weight: .bold)
        titleLabel.textAlignment = .center
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let usageTextRow = UIStackView(arrangedSubviews: [titleLabel, usageLabel, usageTokenLabel])
        usageTextRow.axis = .vertical
        usageTextRow.alignment = .leading
        usageTextRow.spacing = 4
        usageTextRow.translatesAutoresizingMaskIntoConstraints = false

        let spacer = UIView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        spacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        actionRow.addArrangedSubview(messageEditButton)
        actionRow.addArrangedSubview(apiKeyButton)
        actionRow.addArrangedSubview(refreshButton)

        topControlRow.addArrangedSubview(closeButton)
        topControlRow.addArrangedSubview(spacer)
        topControlRow.addArrangedSubview(actionRow)

        usageBar.addSubview(topControlRow)
        usageBar.addSubview(usageTextRow)
        NSLayoutConstraint.activate([
            topControlRow.topAnchor.constraint(equalTo: usageBar.topAnchor, constant: 8),
            topControlRow.leadingAnchor.constraint(equalTo: usageBar.leadingAnchor, constant: 10),
            topControlRow.trailingAnchor.constraint(equalTo: usageBar.trailingAnchor, constant: -10),
            usageTextRow.topAnchor.constraint(equalTo: topControlRow.bottomAnchor, constant: 4),
            usageTextRow.leadingAnchor.constraint(equalTo: usageBar.leadingAnchor, constant: 10),
            usageTextRow.trailingAnchor.constraint(equalTo: usageBar.trailingAnchor, constant: -10),
            usageTextRow.bottomAnchor.constraint(equalTo: usageBar.bottomAnchor, constant: -8)
        ])

        NSLayoutConstraint.activate([
            closeButton.heightAnchor.constraint(equalToConstant: 36),
            messageEditButton.heightAnchor.constraint(equalToConstant: 36),
            apiKeyButton.heightAnchor.constraint(equalToConstant: 36),
            refreshButton.heightAnchor.constraint(equalToConstant: 36),
            closeButton.widthAnchor.constraint(equalToConstant: 36),
            messageEditButton.widthAnchor.constraint(equalToConstant: 36),
            apiKeyButton.widthAnchor.constraint(equalToConstant: 36),
            refreshButton.widthAnchor.constraint(equalToConstant: 36),
            topControlRow.heightAnchor.constraint(greaterThanOrEqualToConstant: 36)
        ])

        [messageEditButton, apiKeyButton, refreshButton, closeButton].forEach { button in
            button.backgroundColor = UIColor.systemBlue.withAlphaComponent(0.1)
            button.layer.cornerRadius = 18
            button.clipsToBounds = true
            button.setContentCompressionResistancePriority(.required, for: .horizontal)
        }
    }

    private func configureMessageEditToolbar() {
        messageEditToolbar.translatesAutoresizingMaskIntoConstraints = false
        messageEditToolbar.axis = .horizontal
        messageEditToolbar.alignment = .center
        messageEditToolbar.spacing = 8
        messageEditToolbar.distribution = .fill
        messageEditToolbar.backgroundColor = UIColor.secondarySystemBackground
        messageEditToolbar.layer.cornerRadius = 14
        messageEditToolbar.isHidden = true

        selectAllMessagesButton.setTitle("전체 선택", for: .normal)
        selectAllMessagesButton.addTarget(self, action: #selector(selectAllMessagesTapped), for: .touchUpInside)
        selectAllMessagesButton.setContentHuggingPriority(.required, for: .horizontal)

        deleteSelectedMessagesButton.setTitle("선택 삭제", for: .normal)
        deleteSelectedMessagesButton.setTitleColor(.systemRed, for: .normal)
        deleteSelectedMessagesButton.addTarget(self, action: #selector(deleteSelectedMessagesTapped), for: .touchUpInside)
        deleteSelectedMessagesButton.setContentHuggingPriority(.required, for: .horizontal)

        finishMessageEditButton.setTitle("완료", for: .normal)
        finishMessageEditButton.addTarget(self, action: #selector(messageEditTapped), for: .touchUpInside)
        finishMessageEditButton.setContentHuggingPriority(.required, for: .horizontal)

        let spacer = UIView()
        messageEditToolbar.addArrangedSubview(selectAllMessagesButton)
        messageEditToolbar.addArrangedSubview(spacer)
        messageEditToolbar.addArrangedSubview(deleteSelectedMessagesButton)
        messageEditToolbar.addArrangedSubview(finishMessageEditButton)
        updateMessageEditControls()
    }

    private func makeSeparator() -> UIView {
        let bar = UIView()
        bar.backgroundColor = UIColor.separator
        bar.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return bar
    }

    private func makeSectionTitle(_ text: String) -> UILabel {
        let label = UILabel()
        label.font = .boldSystemFont(ofSize: 16)
        label.text = text
        return label
    }

    private func makeMessageBubble(_ role: String, _ text: String, index: Int) -> UIView {
        let isUser = role == "user"
        let isSystem = role == "system"

        let row = UIStackView()
        row.axis = .horizontal
        row.alignment = .top
        row.spacing = 6
        row.translatesAutoresizingMaskIntoConstraints = false

        let bubbleContainer = UIView()
        bubbleContainer.translatesAutoresizingMaskIntoConstraints = false
        bubbleContainer.layer.cornerRadius = 16
        bubbleContainer.layer.masksToBounds = true
        bubbleContainer.backgroundColor = isUser
            ? UIColor.systemBlue
            : (isSystem ? UIColor.systemGray5 : UIColor.systemGray3)
        if isUser {
            if #available(iOS 11.0, *) {
                bubbleContainer.layer.maskedCorners = [
                    .layerMinXMaxYCorner,
                    .layerMinXMinYCorner,
                    .layerMaxXMinYCorner
                ]
            }
        } else {
            if #available(iOS 11.0, *) {
                bubbleContainer.layer.maskedCorners = [
                    .layerMinXMaxYCorner,
                    .layerMaxXMaxYCorner,
                    .layerMaxXMinYCorner
                ]
            }
        }

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 0
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.text = text
        label.textColor = isUser ? .white : .label

        bubbleContainer.addSubview(label)
        NSLayoutConstraint.activate([
            label.topAnchor.constraint(equalTo: bubbleContainer.topAnchor, constant: 10),
            label.bottomAnchor.constraint(equalTo: bubbleContainer.bottomAnchor, constant: -10),
            label.leadingAnchor.constraint(equalTo: bubbleContainer.leadingAnchor, constant: 12),
            label.trailingAnchor.constraint(equalTo: bubbleContainer.trailingAnchor, constant: -12)
        ])

        let leftSpacer = UIView()
        let rightSpacer = UIView()
        leftSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        rightSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        leftSpacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        rightSpacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        if isUser {
            row.addArrangedSubview(leftSpacer)
            row.addArrangedSubview(bubbleContainer)
            row.addArrangedSubview(UIView())
        } else {
            row.addArrangedSubview(UIView())
            row.addArrangedSubview(bubbleContainer)
            row.addArrangedSubview(rightSpacer)
        }

        NSLayoutConstraint.activate([
            bubbleContainer.widthAnchor.constraint(lessThanOrEqualToConstant: UIScreen.main.bounds.width * 0.78)
        ])

        guard isMessageEditMode else { return row }

        let selectionButton = UIButton(type: .system)
        selectionButton.translatesAutoresizingMaskIntoConstraints = false
        selectionButton.tag = index
        selectionButton.setImage(
            UIImage(systemName: selectedMessageIndexes.contains(index) ? "checkmark.circle.fill" : "circle"),
            for: .normal
        )
        selectionButton.tintColor = .systemBlue
        selectionButton.accessibilityLabel = "\(index + 1)번째 메시지 선택"
        selectionButton.addTarget(self, action: #selector(toggleMessageSelection(_:)), for: .touchUpInside)
        selectionButton.widthAnchor.constraint(equalToConstant: 30).isActive = true

        let editableRow = UIStackView(arrangedSubviews: [selectionButton, row])
        editableRow.axis = .horizontal
        editableRow.alignment = .top
        editableRow.spacing = 6
        editableRow.translatesAutoresizingMaskIntoConstraints = false
        return editableRow
    }

    private func seedMessagesIfNeeded() {
        if messages.isEmpty {
            messages.append(
                ChatMessage(
                    role: "system",
                    content: "안전보조 챗봇입니다. 질문을 입력하면 119/안전 안내 중심으로 짧게 도움을 드립니다."
                )
            )
            rebuildMessageBubbles()
        }
    }

    private func rebuildMessageBubbles() {
        messagesStack.arrangedSubviews.forEach { view in
            messagesStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }

        for (index, message) in messages.enumerated() {
            messagesStack.addArrangedSubview(makeMessageBubble(message.role, message.content, index: index))
        }

        scrollToBottomOfChat()
    }

    private func scrollToBottomOfChat() {
        guard let scroll = rootScrollView else { return }
        DispatchQueue.main.async {
            let maxOffsetY = max(0, scroll.contentSize.height - scroll.bounds.height)
            if maxOffsetY > 0 {
                scroll.setContentOffset(CGPoint(x: 0, y: maxOffsetY), animated: true)
            }
        }
    }

    private func updateUsageLabel() {
        let tokenText = totalTokens > 0
            ? " / 토큰: 총 \(totalTokens)"
            : ""
        usageLabel.text = "\(activeProvider.title) · 요청 \(requestCount)건"
        if tokenText.isEmpty {
            usageTokenLabel.text = "최근 응답 토큰: 없음"
        } else {
            usageTokenLabel.text = "최근 응답 토큰: 총 \(totalTokens)"
        }
    }

    private func loadSavedState() {
        let storedProviders = AssistantProvider.allCases.filter { VitAlGuardAssistantKeychain.load($0) != nil }
        if storedProviders.isEmpty {
            statusLabel.text = "저장된 API 키가 없습니다. OpenAI 또는 HyperCLOVA 중 하나를 저장해 주세요."
            setKeySettingsVisible(true, animated: false)
        } else {
            let providerNames = storedProviders.map(\.title).joined(separator: ", ")
            statusLabel.text = "저장됨: \(providerNames). 선택한 제공자 키가 없으면 다른 저장 키를 사용합니다."
            setKeySettingsVisible(false, animated: false)
        }
        updateUsageLabel()
    }

    private func appendLog(_ role: String, text: String) {
        let marker: String
        if role == "user" {
            marker = "user"
        } else if role == "assistant" {
            marker = "assistant"
        } else {
            marker = "system"
        }
        messages.append(ChatMessage(role: marker, content: text))
        rebuildMessageBubbles()
    }

    private func updateBusy(_ busy: Bool) {
        sendButton.isEnabled = !busy
        saveButton.isEnabled = !busy
        deleteButton.isEnabled = !busy
        inputField.isEditable = !busy
        sendButton.setImage(UIImage(systemName: busy ? "hourglass" : "arrow.up"), for: .normal)
    }

    private func availableCredential() -> (provider: AssistantProvider, apiKey: String)? {
        let providers = [activeProvider] + AssistantProvider.allCases.filter { $0 != activeProvider }
        for provider in providers {
            if let stored = VitAlGuardAssistantKeychain.load(provider), !stored.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return (provider, stored)
            }
        }
        if let typed = keyField.text?.trimmingCharacters(in: .whitespacesAndNewlines), !typed.isEmpty {
            return (activeProvider, typed)
        }
        return nil
    }

    private func updateProviderField() {
        keyField.placeholder = activeProvider.keyPlaceholder
        keyField.accessibilityLabel = activeProvider.keyPlaceholder
    }

    private func setKeySettingsVisible(_ visible: Bool, animated: Bool) {
        guard keySettingsCard.isHidden == !visible || keySettingsHeightConstraint?.constant != (visible ? keySettingsExpandedHeight : 0) else { return }
        keySettingsCard.isHidden = false
        keySettingsHeightConstraint?.constant = visible ? keySettingsExpandedHeight : 0
        let updates = {
            self.keySettingsCard.alpha = visible ? 1 : 0
            self.view.layoutIfNeeded()
        }
        let completion: (Bool) -> Void = { _ in
            self.keySettingsCard.isHidden = !visible
        }
        if animated {
            UIView.animate(withDuration: 0.2, animations: updates, completion: completion)
        } else {
            updates()
            completion(true)
        }
    }

    @objc private func providerChanged() {
        updateProviderField()
        if VitAlGuardAssistantKeychain.load(activeProvider) != nil {
            statusLabel.text = "\(activeProvider.title) 키가 이 기기에 저장되어 있습니다."
        } else {
            statusLabel.text = "\(activeProvider.title) API 키를 입력하고 저장해 주세요."
        }
        updateUsageLabel()
    }

    @objc private func saveKeyTapped() {
        statusLabel.textColor = .secondaryLabel
        guard let key = keyField.text?.trimmingCharacters(in: .whitespacesAndNewlines), key.count >= 20 else {
            statusLabel.text = "키가 너무 짧습니다. 정확한 API 키를 입력해 주세요."
            statusLabel.textColor = .systemOrange
            return
        }

        do {
            try VitAlGuardAssistantKeychain.save(key, for: activeProvider)
            keyField.text = ""
            loadSavedState()
            statusLabel.text = "\(activeProvider.title) 키가 이 기기의 Keychain에 저장되었습니다."
            statusLabel.textColor = .systemGreen
        } catch {
            statusLabel.text = "키 저장 실패: 로컬 보안 저장에 실패했습니다."
            statusLabel.textColor = .systemRed
        }
    }

    @objc private func deleteKeyTapped() {
        do {
            try VitAlGuardAssistantKeychain.remove(activeProvider)
            loadSavedState()
            statusLabel.text = "\(activeProvider.title) 키가 삭제되었습니다."
            statusLabel.textColor = .systemOrange
            keyField.text = ""
        } catch {
            statusLabel.text = "키 삭제 실패: 키를 확인해 주세요."
            statusLabel.textColor = .systemRed
        }
    }

    @objc private func clearTapped() {
        messages.removeAll()
        seedMessagesIfNeeded()
        statusLabel.text = "대화가 초기화되었습니다."
        statusLabel.text = statusLabel.text
    }

    @objc private func focusAPIKeyTapped() {
        let willShow = keySettingsCard.isHidden
        setKeySettingsVisible(willShow, animated: true)
        if willShow {
            DispatchQueue.main.async { self.keyField.becomeFirstResponder() }
        }
    }

    @objc private func refreshConversationTapped() {
        requestCount = 0
        totalPromptTokens = 0
        totalCompletionTokens = 0
        totalTokens = 0
        updateUsageLabel()
        messages.removeAll()
        seedMessagesIfNeeded()
        statusLabel.text = "채팅이 새로고침되었습니다."
    }

    @objc private func messageEditTapped() {
        isMessageEditMode.toggle()
        if !isMessageEditMode {
            selectedMessageIndexes.removeAll()
        }
        updateMessageEditControls()
        rebuildMessageBubbles()
    }

    @objc private func toggleMessageSelection(_ sender: UIButton) {
        if selectedMessageIndexes.contains(sender.tag) {
            selectedMessageIndexes.remove(sender.tag)
        } else {
            selectedMessageIndexes.insert(sender.tag)
        }
        updateMessageEditControls()
        rebuildMessageBubbles()
    }

    @objc private func selectAllMessagesTapped() {
        if selectedMessageIndexes.count == messages.count {
            selectedMessageIndexes.removeAll()
        } else {
            selectedMessageIndexes = Set(messages.indices)
        }
        updateMessageEditControls()
        rebuildMessageBubbles()
    }

    @objc private func deleteSelectedMessagesTapped() {
        guard !selectedMessageIndexes.isEmpty else { return }
        let selected = selectedMessageIndexes
        messages = messages.enumerated().compactMap { selected.contains($0.offset) ? nil : $0.element }
        selectedMessageIndexes.removeAll()
        isMessageEditMode = false
        statusLabel.text = "선택한 채팅 내역을 삭제했습니다."
        statusLabel.textColor = .secondaryLabel
        updateMessageEditControls()
        rebuildMessageBubbles()
    }

    private func updateMessageEditControls() {
        let isEditing = isMessageEditMode
        messageEditToolbar.isHidden = !isEditing
        messageEditToolbarHeightConstraint?.constant = isEditing ? 44 : 0
        messageEditButton.tintColor = isEditing ? .systemRed : .systemBlue
        selectAllMessagesButton.setTitle(selectedMessageIndexes.count == messages.count && !messages.isEmpty ? "전체 해제" : "전체 선택", for: .normal)
        deleteSelectedMessagesButton.setTitle(selectedMessageIndexes.isEmpty ? "선택 삭제" : "선택 삭제 (\(selectedMessageIndexes.count))", for: .normal)
        deleteSelectedMessagesButton.isEnabled = !selectedMessageIndexes.isEmpty
        deleteSelectedMessagesButton.alpha = selectedMessageIndexes.isEmpty ? 0.45 : 1
        view.setNeedsLayout()
    }

    @objc private func closeTapped() {
        if let onCloseRequest {
            onCloseRequest()
            return
        }

        if let nav = navigationController {
            if nav.presentingViewController != nil {
                nav.dismiss(animated: true)
            } else if nav.viewControllers.count > 1 {
                nav.popViewController(animated: true)
            }
            return
        }

        if presentingViewController != nil {
            dismiss(animated: true)
        }
    }

    @objc private func sendTapped() {
        guard let question = inputField.text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !question.isEmpty,
              question != "메시지" else {
            statusLabel.text = "질문이 비어 있습니다."
            statusLabel.textColor = .systemOrange
            return
        }

        guard let credential = availableCredential() else {
            statusLabel.text = "OpenAI 또는 HyperCLOVA API 키를 하나 이상 저장해 주세요."
            statusLabel.textColor = .systemOrange
            setKeySettingsVisible(true, animated: true)
            return
        }

        if credential.provider != activeProvider {
            providerControl.selectedSegmentIndex = credential.provider.rawValue
            updateProviderField()
            updateUsageLabel()
        }

        let context = attachmentContext()
        let attachmentSummary = pendingAttachments.isEmpty
            ? ""
            : "\n\n첨부: \(pendingAttachments.map { "\($0.kind.title) \($0.displayName)" }.joined(separator: ", "))"
        appendLog("user", text: question + attachmentSummary)
        pendingAttachments.removeAll()
        rebuildAttachmentPreviews()
        restoreInputPlaceholder()
        Task { @MainActor in
            requestCount += 1
            updateUsageLabel()
        }
        updateBusy(true)
        statusLabel.text = "답변을 기다리는 중..."
        statusLabel.textColor = .secondaryLabel

        Task {
            await requestAssistantReply(question: question + context, provider: credential.provider, apiKey: credential.apiKey)
            Task { @MainActor in
                updateBusy(false)
            }
        }
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
        guard textView.text == "메시지" else { return }
        textView.text = ""
        textView.textColor = .label
    }

    func textViewDidEndEditing(_ textView: UITextView) {
        if textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            restoreInputPlaceholder()
        }
    }

    private func restoreInputPlaceholder() {
        inputField.text = "메시지"
        inputField.textColor = .placeholderText
    }

    @objc private func attachmentTapped() {
        let menu = UIAlertController(title: "첨부 추가", message: "사진, 동영상 또는 파일을 대화에 첨부합니다.", preferredStyle: .actionSheet)
        menu.addAction(UIAlertAction(title: "사진 또는 동영상", style: .default) { [weak self] _ in
            self?.presentPhotoVideoPicker()
        })
        menu.addAction(UIAlertAction(title: "파일 선택", style: .default) { [weak self] _ in
            self?.presentFilePicker()
        })
        menu.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let popover = menu.popoverPresentationController {
            popover.sourceView = attachmentButton
            popover.sourceRect = attachmentButton.bounds
        }
        present(menu, animated: true)
    }

    private func presentPhotoVideoPicker() {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .any(of: [.images, .videos])
        configuration.selectionLimit = 5
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        present(picker, animated: true)
    }

    private func presentFilePicker() {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = true
        present(picker, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        let attachments = results.map { result -> AssistantAttachment in
            let provider = result.itemProvider
            let kind: AssistantAttachmentKind = provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) ? .video : .photo
            let name = provider.suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines)
            return AssistantAttachment(kind: kind, displayName: (name?.isEmpty == false ? name! : kind.title))
        }
        addAttachments(attachments)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        controller.dismiss(animated: true)
        let attachments = urls.map { url in
            AssistantAttachment(kind: attachmentKind(for: url), displayName: url.lastPathComponent)
        }
        addAttachments(attachments)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        controller.dismiss(animated: true)
    }

    private func attachmentKind(for url: URL) -> AssistantAttachmentKind {
        guard let type = UTType(filenameExtension: url.pathExtension) else { return .file }
        if type.conforms(to: .image) { return .photo }
        if type.conforms(to: .movie) { return .video }
        return .file
    }

    private func addAttachments(_ attachments: [AssistantAttachment]) {
        guard !attachments.isEmpty else { return }
        pendingAttachments.append(contentsOf: attachments)
        rebuildAttachmentPreviews()
        statusLabel.text = "첨부 \(attachments.count)개를 대화에 추가했습니다."
        statusLabel.textColor = .secondaryLabel
    }

    private func rebuildAttachmentPreviews() {
        attachmentStack.arrangedSubviews.forEach {
            attachmentStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }

        for attachment in pendingAttachments {
            let chip = UIButton(type: .system)
            chip.setImage(UIImage(systemName: attachment.kind.symbol), for: .normal)
            chip.setTitle("  \(attachment.displayName)  ×", for: .normal)
            chip.tintColor = .systemBlue
            chip.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
            chip.backgroundColor = UIColor.systemBackground
            chip.layer.cornerRadius = 16
            chip.layer.borderWidth = 1 / UIScreen.main.scale
            chip.layer.borderColor = UIColor.separator.withAlphaComponent(0.5).cgColor
            chip.contentEdgeInsets = UIEdgeInsets(top: 7, left: 10, bottom: 7, right: 10)
            chip.accessibilityLabel = "\(attachment.kind.title) \(attachment.displayName), 순서 변경 또는 제거"
            chip.accessibilityIdentifier = attachment.id.uuidString
            chip.addTarget(self, action: #selector(editAttachmentTapped(_:)), for: .touchUpInside)
            attachmentStack.addArrangedSubview(chip)
        }

        let visible = !pendingAttachments.isEmpty
        attachmentTray.isHidden = !visible
        attachmentTrayHeightConstraint?.constant = visible ? 52 : 0
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }

    @objc private func editAttachmentTapped(_ sender: UIButton) {
        guard let identifier = sender.accessibilityIdentifier,
              let id = UUID(uuidString: identifier),
              let index = pendingAttachments.firstIndex(where: { $0.id == id }) else { return }

        let attachment = pendingAttachments[index]
        let menu = UIAlertController(title: attachment.displayName, message: "첨부 순서를 바꾸거나 대화에서 제거할 수 있습니다.", preferredStyle: .actionSheet)
        let moveLeft = UIAlertAction(title: "앞으로 이동", style: .default) { [weak self] _ in
            self?.moveAttachment(from: index, to: index - 1)
        }
        moveLeft.isEnabled = index > 0
        let moveRight = UIAlertAction(title: "뒤로 이동", style: .default) { [weak self] _ in
            self?.moveAttachment(from: index, to: index + 1)
        }
        moveRight.isEnabled = index < pendingAttachments.count - 1
        menu.addAction(moveLeft)
        menu.addAction(moveRight)
        menu.addAction(UIAlertAction(title: "첨부 제거", style: .destructive) { [weak self] _ in
            self?.pendingAttachments.removeAll { $0.id == id }
            self?.rebuildAttachmentPreviews()
        })
        menu.addAction(UIAlertAction(title: "취소", style: .cancel))
        if let popover = menu.popoverPresentationController {
            popover.sourceView = sender
            popover.sourceRect = sender.bounds
        }
        present(menu, animated: true)
    }

    private func moveAttachment(from sourceIndex: Int, to destinationIndex: Int) {
        guard pendingAttachments.indices.contains(sourceIndex),
              pendingAttachments.indices.contains(destinationIndex) else { return }
        let attachment = pendingAttachments.remove(at: sourceIndex)
        pendingAttachments.insert(attachment, at: destinationIndex)
        rebuildAttachmentPreviews()
    }

    private func attachmentContext() -> String {
        guard !pendingAttachments.isEmpty else { return "" }
        let details = pendingAttachments.map { "\($0.kind.title): \($0.displayName)" }.joined(separator: ", ")
        return "\n\n[사용자가 첨부한 항목: \(details)]\n파일 원본이 아닌 파일명과 유형만 전달되었습니다. 원본 내용을 볼 수 없으면 사용자에게 필요한 정보를 설명해 달라고 요청하세요."
    }

    @MainActor
    private func requestAssistantReply(question: String, provider: AssistantProvider, apiKey: String) async {
        do {
            let (answer, usage) = try await fetchAnswer(question: question, provider: provider, apiKey: apiKey)
            if let usage {
                Task { @MainActor in
                    totalPromptTokens += usage.promptTokens
                    totalCompletionTokens += usage.completionTokens
                    totalTokens += usage.totalTokens
                    updateUsageLabel()
                }
            }
            appendLog("assistant", text: answer)
            statusLabel.text = "\(provider.title) 응답을 받았습니다."
            statusLabel.textColor = .systemGreen
        } catch {
            if let assistantError = error as? AssistantError {
                statusLabel.text = assistantError.userMessage
            } else {
                statusLabel.text = "네트워크 오류로 답변을 받지 못했습니다."
            }
            statusLabel.textColor = .systemRed
        }
    }

    private func buildMessages(for question: String) -> [ChatMessage] {
        let recentPairs = messages.suffix(8)
        var payload = [ChatMessage(role: "system", content: systemPrompt)]
        payload.append(contentsOf: recentPairs.map { ChatMessage(role: $0.role, content: $0.content) })
        payload.append(ChatMessage(role: "user", content: question))
        return payload
    }

    private struct UsageSnapshot {
        let promptTokens: Int
        let completionTokens: Int
        let totalTokens: Int
    }

    private func fetchAnswer(question: String, provider: AssistantProvider, apiKey: String) async throws -> (String, UsageSnapshot?) {
        switch provider {
        case .openAI:
            return try await fetchOpenAIAnswer(question: question, apiKey: apiKey)
        case .hyperCLOVA:
            return try await fetchHyperCLOVAAnswer(question: question, apiKey: apiKey)
        }
    }

    private func fetchHyperCLOVAAnswer(question: String, apiKey: String) async throws -> (String, UsageSnapshot?) {
        let url = URL(string: "https://clovastudio.stream.ntruss.com/v3/chat-completions/HCX-005")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let requestBody = HyperCLOVARequest(
            messages: buildMessages(for: question),
            temperature: 0.1,
            topP: 0.8,
            maxTokens: 900
        )
        let encoded = try JSONEncoder().encode(requestBody)
        request.httpBody = encoded

        let session = URLSession(configuration: .ephemeral)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AssistantError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw AssistantError.httpError(http.statusCode)
        }

        let usage = parseUsage(from: data)

        do {
            if let reply = try? JSONDecoder().decode(HyperCLOVAReply.self, from: data),
               let first = reply.result?.message?.content, !first.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return (first.trimmingCharacters(in: .whitespacesAndNewlines), usage)
            }
            if let reply = try? JSONDecoder().decode(ChatReply.self, from: data),
               let first = reply.choices.first?.message.content,
               !first.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return (first.trimmingCharacters(in: .whitespacesAndNewlines), usage)
            }
            if let errorPayload = try? JSONDecoder().decode(ChatErrorPayload.self, from: data),
               let msg = errorPayload.error?.message {
                throw AssistantError.serverMessage(msg)
            }
            throw AssistantError.invalidResponse
        }
    }

    private func fetchOpenAIAnswer(question: String, apiKey: String) async throws -> (String, UsageSnapshot?) {
        let url = URL(string: "https://api.openai.com/v1/chat/completions")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(
            OpenAIRequest(
                model: "chat-latest",
                messages: buildMessages(for: question),
                temperature: 0.2,
                maxTokens: 900
            )
        )

        let session = URLSession(configuration: .ephemeral)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AssistantError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw AssistantError.httpError(http.statusCode)
        }

        let usage = parseUsage(from: data)
        if let reply = try? JSONDecoder().decode(ChatReply.self, from: data),
           let first = reply.choices.first?.message.content,
           !first.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return (first.trimmingCharacters(in: .whitespacesAndNewlines), usage)
        }
        if let errorPayload = try? JSONDecoder().decode(ChatErrorPayload.self, from: data),
           let message = errorPayload.error?.message {
            throw AssistantError.serverMessage(message)
        }
        throw AssistantError.invalidResponse
    }

    private func parseUsage(from data: Data) -> UsageSnapshot? {
        guard let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        let usage: [String: Any]? = {
            if let usage = raw["result"] as? [String: Any], let nested = usage["usage"] as? [String: Any] {
                return nested
            }
            if let usage = raw["usage"] as? [String: Any] {
                return usage
            }
            return nil
        }()

        guard let usage = usage else { return nil }

        let promptTokens = parseInt(usage["promptTokens"]) ?? parseInt(usage["prompt_tokens"]) ?? 0
        let completionTokens = parseInt(usage["completionTokens"]) ?? parseInt(usage["completion_tokens"]) ?? 0
        let totalTokens = parseInt(usage["totalTokens"]) ?? parseInt(usage["total_tokens"]) ?? (promptTokens + completionTokens)

        if promptTokens == 0 && completionTokens == 0 && totalTokens == 0 {
            return nil
        }
        return UsageSnapshot(promptTokens: promptTokens, completionTokens: completionTokens, totalTokens: totalTokens)
    }

    private func parseInt(_ value: Any?) -> Int? {
        if let intValue = value as? Int {
            return intValue
        }
        if let doubleValue = value as? Double {
            return Int(doubleValue)
        }
        if let number = value as? NSNumber {
            return number.intValue
        }
        if let string = value as? String {
            return Int(string.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return nil
    }
}

private enum AssistantError: Error {
    case keychainSaveFailed(OSStatus)
    case keychainDeleteFailed(OSStatus)
    case invalidResponse
    case httpError(Int)
    case emptyReply
    case serverMessage(String)

    var userMessage: String {
        switch self {
        case .keychainSaveFailed:
            return "로컬 보안 저장 실패. 기기 권한을 확인해 주세요."
        case .keychainDeleteFailed:
            return "키 삭제를 완료하지 못했습니다."
        case .invalidResponse:
            return "응답 형식을 처리할 수 없습니다."
        case .emptyReply:
            return "답변이 비어 있습니다."
        case .serverMessage(let msg):
            if msg.contains("rate_limit") {
                return "요청 한도 초과입니다. 잠시 후 다시 시도해 주세요."
            }
            if msg.contains("invalid_api_key") || msg.contains("Incorrect API key") || msg.contains("Invalid API key") {
                return "API 키가 유효하지 않습니다."
            }
            return "요청 실패: \(msg)"
        case .httpError(let code):
            switch code {
            case 401:
                return "API 키 인증 실패(401). 키를 다시 저장해 주세요."
            case 429:
                return "요청이 과도합니다(429). 잠시 후 재시도해 주세요."
            default:
                return "API 응답 오류(\(code))."
            }
        }
    }
}

private struct HyperCLOVARequest: Codable {
    let messages: [ChatMessage]
    let temperature: Double
    let topP: Double
    let maxTokens: Int
}

private struct OpenAIRequest: Codable {
    let model: String
    let messages: [ChatMessage]
    let temperature: Double
    let maxTokens: Int

    enum CodingKeys: String, CodingKey {
        case model
        case messages
        case temperature
        case maxTokens = "max_tokens"
    }
}

private struct ChatReply: Codable {
    let choices: [ChatChoice]
}

private struct HyperCLOVAReply: Codable {
    let result: HyperCLOVAReplyResult?
}

private struct HyperCLOVAReplyResult: Codable {
    let message: ReplyMessage?
}

private struct ChatChoice: Codable {
    let message: ReplyMessage
}

private struct ReplyMessage: Codable {
    let role: String
    let content: String
}

private struct ChatErrorPayload: Codable {
    let error: ChatErrorMessage?
}

private struct ChatErrorMessage: Codable {
    let message: String
}
