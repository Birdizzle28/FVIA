<?php
header("Access-Control-Allow-Origin: https://fv-ia.com"); // or your real Netlify domain
header("Access-Control-Allow-Methods: POST");
header("Access-Control-Allow-Headers: Content-Type");
// Only allow POST requests
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Collect and sanitize input
    $name    = htmlspecialchars(trim($_POST["name"]));
    $email   = filter_var(trim($_POST["email"]), FILTER_SANITIZE_EMAIL);
    $phone   = htmlspecialchars(trim($_POST["phone"]));
    $message = htmlspecialchars(trim($_POST["message"]));

    // Validate email
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        die("Invalid email format.");
    }

    // Recipient email (your email)
    $to = "fvinsuranceagency@gmail.com"; // ← Replace this with your email

    // Subject and message
    $subject = "New Contact Form Submission from $name";
    $body = "Name: $name\nEmail: $email\nPhone: $phone\n\nMessage:\n$message";

    // Headers
    $headers = "From: $name <$email>\r\nReply-To: $email";

    // Send the email
    if (mail($to, $subject, $body, $headers)) {
        echo "Message sent successfully!";
    } else {
        echo "Something went wrong. Please try again later.";
    }
} else {
    // If not POST, block access
    http_response_code(403);
    echo "Forbidden";
}
?>