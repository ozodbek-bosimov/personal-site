from django.urls import path

from home import views

urlpatterns = [
    path("", views.index, name="home"),
    path("about/", views.about, name="about"),
    path("blog/", views.blog, name="blog"),
    path("projects/", views.projects, name="projects"),
    path("blog/<str:slug>/", views.blogpost, name="blogpost"),
    path("topic/<str:topic>/", views.topic, name="topic"),
    path("topics/", views.topics, name="topics"),
    path("search/", views.search, name="search"),
    path("resume/", views.resume_view, name="resume"),
    path("resume/<str:filename>", views.resume_view, name="resume_file"),
    path(
        "github-contributions/",
        views.github_calendar_proxy,
        name="github_contributions",
    ),
    path("leetcode-proxy/", views.leetcode_proxy, name="leetcode_proxy"),
    path(
        "api/detect-form-fields/", views.detect_form_fields, name="detect_form_fields"
    ),
]
